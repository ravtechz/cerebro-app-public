# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

`mobile/` holds the Expo app (Faza 01, implemented). `db/` holds the Postgres migrations and their runner (Faza 03, applied on the VM). `backend/` holds the FastAPI service (Faza 04, deployed and running on the VM under systemd).

The git repo is rooted here, at the project root — not at `mobile/`. Setup from scratch (VM, Tailscale, Postgres, Ollama, backend, iOS build) is in `README.md`.

## Commands

All commands run from `mobile/`:

```bash
npm start           # Metro (iOS is the dev target)
npm run ios         # native build onto simulator or device — NOT Expo Go anymore
npm run typecheck   # tsc --noEmit — strict, must stay clean
npm run bundle      # expo export; catches import/resolution errors without a device

npm run web         # Metro on :8081
npm run web:preview # in a second terminal — open http://localhost:8082
```

**Expo Go cannot run this project on a physical device.** The App Store client is
stuck at 54.0.2 (Sept 2025, RN 0.81) while the project is on SDK 57 / RN 0.86 —
the phone answers "Project is incompatible with this version of Expo Go". The
*simulator* still works because Expo CLI downloads the matching 57.x client
directly, bypassing the App Store.

Real devices therefore need a **development build**: `npx expo prebuild -p ios`
generates `ios/` (gitignored, regenerated from `app.json` + `package.json` — never
edit it by hand), and `npx expo run:ios --device <udid>` builds and installs it.
That needs CocoaPods and an Apple ID in Xcode. Signing with a free Personal Team
expires after **7 days**, after which the app stays installed but refuses to
launch until it is rebuilt from the Mac; a paid account ($99/yr) makes it a year.

**For everyday use on the phone, build Release, not Debug.** A Debug build has no
JS inside it: it fetches the bundle from Metro at launch, so it only works while
the Mac is awake, running `npm start`, and reachable from the phone. Release
embeds `main.jsbundle`, needs no Metro at all, and works on cellular:

```bash
EXPO_APPLE_TEAM_ID=<team> npx expo run:ios --configuration Release --device <udid>
```

Debug is for iterating with fast refresh; Release is what you actually carry
around.

**`REACT_NATIVE_PACKAGER_HOSTNAME` does not decide where a Debug build looks for
Metro.** The host is written into `ip.txt` inside the `.app` by
`react-native/scripts/react-native-xcode.sh`, which takes it straight from the
LAN interface (`ipconfig getifaddr en0`) and never consults that variable. So a
Debug build always points at the Mac's Wi-Fi address, works at home, and dies
with *"No script URL provided … unsanitizedScriptURLString = (null)"* the moment
the phone leaves the network — which reads like a crash, not like a missing
packager. To point a Debug build somewhere else, use the in-app dev menu (shake →
*Configure Bundler* / *Debug server host & port for device*), or just build
Release.

**ATS blocks the backend unless `NSAllowsArbitraryLoads` stands alone.** The API
is plain HTTP on a Tailscale address (`100.64.0.0/10`), and iOS refuses cleartext
by default — the app reports "retea indisponibila" while Safari on the same phone
loads the same URL fine, because Safari is not bound by the app's ATS policy.
Setting `NSAllowsArbitraryLoads: true` is not enough on its own: per Apple, the
presence of any fine-grained key (`NSAllowsLocalNetworking`,
`NSAllowsArbitraryLoadsInWebContent`, `NSAllowsArbitraryLoadsForMedia`) **forces
`NSAllowsArbitraryLoads` back to NO** on iOS 10+. Expo's prebuild emits
`NSAllowsLocalNetworking` by default, which silently cancels the exception — and
that key does not cover CGNAT space anyway. `ios.infoPlist.NSAppTransportSecurity`
in `app.json` must therefore contain `NSAllowsArbitraryLoads` and nothing else.

The blunt exception is deliberate: the base URL is user-supplied at runtime from
Settings, so a per-host exception would break the moment it is edited, and the
only traffic involved already rides an encrypted WireGuard tunnel. Tightening this
means giving the backend real HTTPS (`tailscale serve`), not narrowing the key.

**A successful CLI build is not an installable one.** `expo run:ios` leaves the
prebuilt XCFrameworks unsigned — `React`, `hermesvm`, `ReactNativeDependencies`,
`ExpoFileSystem`, `ExpoModulesWorklets` — and the device rejects the whole bundle
with `ApplicationVerificationFailed`. Expo's own error message says nothing
useful; `xcrun devicectl device install app --device <udid> <path>` names the
offending framework. Fix by signing each one and then re-signing the bundle:

```bash
codesign --force --sign "$ID" --timestamp=none "$APP"/Frameworks/*.framework
codesign -d --entitlements :ent.plist "$APP"          # before re-signing
codesign --force --sign "$ID" --entitlements ent.plist --timestamp=none "$APP"
codesign -v --deep --strict "$APP"                    # must be clean
```

**`mobile/install-device.sh` is the way to put a build on the phone.** Use it
instead of `expo run:ios --device`, which cannot renew an expired provisioning
profile: it never passes `-allowProvisioningUpdates` to xcodebuild, so once the
free Personal Team's 7-day profile lapses every build dies with *"No profiles for
'com.example.cerebro' were found … Automatic signing is disabled and unable to
generate a profile."* The script calls xcodebuild directly with that flag, checks
the signature, installs with `devicectl` and opens the app.

```bash
EXPO_APPLE_TEAM_ID=<team-id> ./install-device.sh   # build, install, launch
./install-device.sh --status   # profile expiry + what the phone has, builds nothing
```

Two things it does deliberately. It builds against `generic/platform=iOS` rather
than the device: with `-destination id=<udid>` xcodebuild waits for the developer
disk image and dies with *"could not be mounted"* whenever the phone is locked,
while signing needs no device at all. And it separates the three ways a launch
can be refused — a new profile that has not been **trusted** by hand
(*Settings → General → VPN & Device Management*), a **locked** phone, and
anything else. Only the third is a failure; the first two mean the install
worked and the phone needs a tap.

None of this makes the profile last longer. It expires 7 days after it is issued,
the app stays installed but refuses to launch, and the fix is to run the script
again. A paid account ($99/yr) is what turns the week into a year.

Backend commands run from `backend/`:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload      # local dev server on :8000
HOST=user@cerebro-vm ./deploy.sh             # ssh deploy: pull, install, migrate, restart
HOST=user@cerebro-vm ./deploy.sh --status    # service status + recent logs
```

The tests need a real PostgreSQL — the behaviours they cover (upsert idempotency,
last-write-wins, cross-user isolation) are SQL semantics, so a mocked database
proves nothing. The LLM is always faked in tests.

```bash
docker run -d --name cerebro-test -p 55432:5432 \
  -e POSTGRES_USER=cerebro -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cerebro postgres:18
TEST_DATABASE_URL=postgresql://cerebro:test@localhost:55432/cerebro .venv/bin/python -m pytest
```

The reference VM (Ubuntu 22.04) runs **Python 3.10**, not 3.12 — keep backend code 3.10-compatible.

**Desktop preview**: the app runs in a browser via react-native-web, but `expo-sqlite`
compiles to WebAssembly there and needs `SharedArrayBuffer`, i.e. a cross-origin-isolated
page. Expo's dev server wraps Metro with its own middleware, so the COOP/COEP headers set
in `metro.config.js` never reach the response — `scripts/web-preview.mjs` is a dev-only
proxy that injects them and forwards Metro's hot-reload websocket. Always open the proxy
port (8082), not 8081. Web support in expo-sqlite is alpha; the phone remains the real
target.

**Node >= 20.19.4 is required** by Expo SDK 57. Metro prints a hard warning and may misbehave on older versions.

There is no test runner and no linter configured — `npm run typecheck` plus `npm run bundle` are the checks that exist.

## Mobile app layout (`mobile/src/`)

Deliberately flat, no navigation library — the sidebar picks a view and Settings is a full-screen swap in `App.tsx`.

- `theme/` — the five themes, the size scale and the `useStyles` / `useTheme` hooks; the only place colors, fonts, radii and glows live (see "Design system")
- `db/` — SQLite is the source of truth. `client.ts` owns the schema, seed and the 30-day purge; `notes.ts` / `categories.ts` / `settings.ts` are the query layers. Rows are snake_case, app types are camelCase; the `toNote`/`toCategory` mappers are the boundary.
- `api/` — the `ApiClient` interface and wire types (snake_case, mirroring the Faza 04 JSON contract) plus `MockApiClient`. `getApiClient()` is the seam Faza 05 fills with `HttpApiClient`.
- `sync/worker.ts` — `runSyncCycle()` behind a module-level mutex, backoff timer, AppState + NetInfo triggers
- `store/useStore.ts` — Zustand. Every mutation writes to SQLite, reloads from it, then fires a sync cycle; the store never holds state SQLite doesn't have.
- `drag/` — the drag & drop gesture: `useNoteDrag` (state and animation) and `tapGuard` (see below)
- `components/`, `screens/`, `ui/`, `utils/`

Two conventions that are easy to break: local categories take ids from `LOCAL_CATEGORY_ID_BASE` (100000) so they cannot collide with server ids before `confirmCategory()` remaps them, and `markCategorizing()` deliberately does not touch `updated_at` — that column is what marks a note dirty, and transport state is not a mutation.

**Deleting a category is a synced mutation, not a local one.** `/sync` always answers with the user's full category list, and `mergeServerCategories()` re-inserts anything still on it — so a local-only delete silently resurrects on the next real sync (never in mock mode, which reads the local table). The deletion therefore rides in `SyncPayload.deleted_categories`, and a row in the local `deleted_categories` table tombstones the id until the server drops it. Absence from the response's category list *is* the acknowledgement — no extra field. Its notes go to the trash rather than vanishing: `category_id` becomes NULL locally, the user's Inbox on the server (the FK is `NOT NULL`), and an already-trashed note keeps its original `deleted_at` so its 30-day clock does not restart. Inbox itself can never be deleted, on either side.

**A sync response may only be applied to the revision it was an answer to.**
`applySyncedNote()` takes the `updated_at` that actually went out in the request
and updates nothing unless the row still carries it. Without that guard a
mutation made *during* the round trip is destroyed silently rather than loudly:
the response overwrites `category_id` and stamps `synced_at` past `updated_at`,
so the note stops being dirty and the change never ships. Skipping the write
leaves it dirty and the next cycle sends the newer version, which the server's
last-write-wins upsert accepts. This is safe only because `/sync` echoes back
the notes it was sent and never pulls others — a future pull-side sync has to
revisit it.

**Dragging a note into a category is a normal mutation, and Inbox is written as
`INBOX_ID`, never as NULL.** The worker derives `needs_categorization` from
`categoryId === null`, so a NULL would hand the note straight back to the LLM and
undo the move on the next cycle; an explicit id reads as the user's choice and
the server honours it. This is the mirror image of `markSyncFailed()`, where
writing `INBOX_ID` was the bug for exactly the same reason — there, nobody had
chosen it.

The gesture itself uses `PanResponder` + `Animated` from RN core; there is no
gesture-handler and no reanimated in this project, and adding a native dependency
for one gesture was not worth the rebuild. Two things there are less obvious than
they look. The card claims nothing on touch down — a hold surviving
`layout.dragHoldMs` arms it, and only then does the first movement take the
responder from the FlatList; toggling `scrollEnabled` instead is the obvious fix
and it cancels the in-flight touch on iOS, killing the drag as it starts. And
because a hold arms the drag *before* the finger moves, every Pressable inside
the card is still waiting to fire — so an abandoned drag ticks the note done or
opens a browser unless the handler is wrapped in `unlessDragged()`. Dragging and
releasing is fine on its own: winning the responder cancels the press underneath.

Contents:
- `README.md` — step-by-step installation, in Romanian
- `cerebro-mobile-mockup.html` — self-contained interactive HTML mockup of the mobile UI (a bundled React app inlined in a `<script>` tag). Open it in a browser to see the target look and interactions: sidebar collapse, note cards, status chips, chat bar, scanlines/glow. This is the visual contract for Faza 01.
- `cerebro-themes.css` — the design source for the four non-synthwave themes: every token as a CSS custom property, one block per theme, with `.cb-root` holding the synthwave fallback. This is the authority for their hexes, fonts, radii and glows. It came from a set of interactive HTML mockups that are no longer in the tree (they were 17MB and their content is now in `mobile/src/theme/themes/`); those also carried three themes the app never shipped — `sunset`, `matrix`, `press` — which are not in this file.
- `arhitectura-cerebro-app.excalidraw` — architecture diagram (open it at excalidraw.com)

## Project phases

The project was built in phases, and code comments refer to them as "Faza NN":

| Phase | What | State |
|---|---|---|
| Faza 01 | Expo/React Native app, SQLite, sync worker | done |
| Faza 02 | VM on the NAS, Tailscale, ufw | done |
| Faza 03 | Postgres schema, migrations, user provisioning | done |
| Faza 04 | FastAPI + LLM categorizer, deployment | done |
| Faza 05 | `HttpApiClient` + real-device validation | done |
| Faza 06 | read-only web + pgvector | future — not before 01-05 are stable |
| Faza 07 | Android build/QA from the same codebase | future |

## What Cerebro is

Multi-user (2-5 people, not SaaS) chat-style note-taking app. The user throws an idea into a chat input, the note appears instantly in local SQLite, then an event-driven sync worker ships it to a FastAPI backend running on a home NAS VM over Tailscale, where an LLM assigns a category. iOS first, Android last.

## Architecture principles (non-negotiable)

1. **Local-first**: SQLite on the phone is the source of truth. The app works fully offline. The backend is only categorization + central store + (future) read-only web.
2. **Instant insert**: a note appears in the UI immediately with status `pending`. Never a blocking spinner on send.
3. **Event-driven sync worker**, not a polling daemon: triggered by new note / app foreground / network regained / pull-to-refresh, with exponential backoff (1s, 5s, 30s, 2min, 15min; max 5 → status `error`). Single `runSyncCycle()` behind a mutex.
4. **Bidirectional sync of all mutations** — create, done, undone, delete, restore — not just new notes.
5. **Idempotency**: note UUIDs are generated on the phone; the server does `INSERT ... ON CONFLICT (uuid) DO UPDATE ... WHERE EXCLUDED.updated_at > notes.updated_at` (last-write-wins). Retries never duplicate.
6. **Dynamic categories**: the category list lives in Postgres, per user; the categorizer injects the user's current list into the LLM prompt. The LLM picks from that list only — it never invents categories.
7. **Honest fallback**: LLM confidence below `CONFIDENCE_THRESHOLD` (**0.6** — gemma3:4b's confidence is compressed upwards, and 0.7 cut correct answers too), invalid response, timeout, or exhausted retries → the note goes to that user's `Inbox`. A note that survives beats a note perfectly categorized.

Note lifecycle: `pending` → `categorizing` → `synced` (or `error`). Trash is a soft delete (`deleted_at`); purged permanently after 30 days — locally by `purgeExpiredTrash()` at app start, on the server by `cerebro-purge.timer` daily. Both sides expire the same rows independently, which is why deletions never travel over `/sync`.

**Ticking a note done moves it to the trash after `DONE_TRASH_DELAY_MS` (10s).** Unticking inside that window cancels it — that is the undo, and no other undo affordance exists. The countdown is one 1s interval in the store driving every pending note, not a timer each; deadlines live in `doneDeadlines` (memory only) and are pruned in `reload()`, which is the single place that cleanup happens. Because the deadlines are not persisted, `trashAllDone()` sweeps at startup: anything still ticked is past its grace period, whether the app was killed mid-countdown or the note predates the rule. `restoreFromTrash()` clears `done` as well as `deleted_at`, and `category_id` is never touched by trashing, so restore returns a note to the category it came from.

## Multi-user model

No accounts, passwords, or OAuth. Each user has one static API key sent as the `X-Api-Key` header; the server hashes it (sha256), looks it up in `users`, and derives `user_id`. **Every query on the backend must be scoped by `user_id`** — notes, categories, purge, everything — and the Faza 04 tests must prove user A cannot see or touch user B's data. Each user has their own categories and their own Inbox (`is_inbox = true`, one per user, undeletable). One device = one user; the local SQLite belongs to that user alone.

## Design system

Synthwave / retro-terminal is the default look (`Synthwave`), specified by the mockup (`cerebro-mobile-mockup.html`). **It is no longer the only one:** five themes ship, picked from a dropdown in Settings — `Synthwave`, `Blush`, `Pastel`, `Almanac`, `Nebula`. Their design source is `cerebro-themes.css` at the project root, which holds every token as a CSS custom property. Take the exact hexes from there; do not invent a palette for a new theme.

In the mobile app, **every color, font, radius and glow goes through `src/theme/`** — zero hardcoded hex in components:

- `theme/tokens.ts` — the `Theme` *contract* plus what is identical in every theme (`space`, `layout`, the size scale, `statusMeta`). It holds no colours.
- `theme/themes/*.ts` — one file per theme, each a complete `Theme`. `themes/index.ts` is the registry (`THEMES`, `THEME_IDS`, `isThemeId`).
- `theme/fonts.ts` — every face any theme names, loaded in one `useFonts` pass at startup. Excalifont (Blush) is a repo asset under `assets/fonts/`, converted to ttf from the woff2 the theme mockups shipped because iOS takes ttf/otf only; it is SIL OFL 1.1 and the licence ships beside it.

**Both the theme and the font size are runtime settings, so there is no static `palette` or `size` export.** `StyleSheet.create` runs once at import and can never follow a runtime setting, so every stylesheet is a factory resolved through a hook:

```ts
const styles = useStyles(makeStyles);                                  // inside the component
const t = useTheme();                                                  // for inline colours only
const makeStyles = (t: Theme, size: Sizes) => StyleSheet.create({ … }); // module scope
```

`useStyles` caches per (factory × theme × size). `useTheme()` covers what a stylesheet cannot hold: icon colours, `placeholderTextColor`, `keyboardAppearance`. Reaching for a bare `palette.pink` fails typecheck — that is deliberate, and deleting the static exports is what proved no consumer was left behind.

Three things vary per theme beyond colour, and they are worth knowing before editing a component:

- **`makeSize(textSize, theme)`** applies the user's scale *and* the theme's: a handwriting or serif face needs more px than a mono to read the same, and the display face needs more again (`size.displayTitle` / `displayLogo` / `displaySmall` are separate steps, only for `theme.font.display`).
- **`type.*Tracking`** are multipliers on the letter-spacing each site already uses, with `1` as the synthwave baseline — the softer themes track much tighter. Same for `type.*Transform`: synthwave uppercases labels, Blush lowercases them, Almanac leaves them alone.
- **`statusBand`** (Blush, Pastel) repeats the note status as a band down the card's left edge, and **`statusGlyphs`** (Synthwave only) prefixes the status with `[~]` / `[>]`. Those two flags are the only structural differences; everything else is tokens.

Per-user themes on the server remain a future project — the setting is local, like `textSize`, and never syncs.

## Versioning

**`mobile/app.json` → `expo.version` is the single source.** `src/version.ts`
imports it (Metro inlines the JSON, no dependency) and the sidebar shows it under
the wordmark as `vX.Y.Z`.

Every feature bumps it. Four steps, in this order:

1. `mobile/app.json` → `expo.version`, and `mobile/package.json` → `version` to
   match (nothing reads the latter, but a mismatch is a trap for the next reader).
2. **`npx expo prebuild -p ios`** — see the warning below.
3. Commit the feature with the bump in it.
4. Tag the commit: `git tag -a vX.Y.Z -m "..."` and `git push origin vX.Y.Z`.

Bump the minor for a feature (themes, deleting categories), the patch for a fix.
Never move a tag that has already been pushed — cut a new one.

**Bumping the version without re-running prebuild makes the app lie about
itself.** `CFBundleShortVersionString` in `ios/Info.plist` is stamped *at prebuild
time*, and `expo run:ios` does not regenerate it — so the sidebar (JavaScript,
rebundled on every run) shows the new version while iOS, the Settings pane and
`devicectl` still report the old one. This shipped once already, on v1.1.0.

Prebuild **clears `ios/` entirely**, which drops `DEVELOPMENT_TEAM` from the
Xcode project. Pass it back on the next build or signing fails:

```bash
EXPO_APPLE_TEAM_ID=<team-id> REACT_NATIVE_PACKAGER_HOSTNAME=<mac-tailscale-ip> \
  npx expo run:ios --device <udid>
```

## Conventions

- **Code and comments in English; UI strings in Romanian without diacritics** (e.g. `"scrie o nota…"`, `"acum 2h"`). The README is written in Romanian.
- Secrets (API keys, LLM key) live only in `.env` — never hardcoded, never in the app bundle. The mobile app takes base URL and API key from its Settings screen.
- Mobile: TypeScript strict, no `any`, components under ~200 lines. Zustand for state, no Redux. No UI component libraries.
- Backend: small and readable — `app/main.py`, `app/routes/`, `app/services/`, `app/db.py`. `asyncpg` with plain SQL, no ORM, no Alembic (migrations are numbered `.sql` files run by `db/migrate.sh` tracking a `schema_migrations` table). Not an enterprise onion architecture.
- The API surface is abstracted behind interfaces so implementations can be swapped without touching callers: `ApiClient` in the app (`MockApiClient` until Faza 05, then `HttpApiClient`) and `Categorizer` on the backend (local Ollama by default, Anthropic as the alternative).
- Avoid platform-specific code in the app except where unavoidable (safe areas, keyboard avoiding, Android back button) — Faza 07 builds Android from the same codebase.
