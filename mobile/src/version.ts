import appJson from '../app.json';

/**
 * The app's version, read from `app.json` rather than restated here. Metro
 * inlines the JSON at build time, so this needs no dependency and works the
 * same in Debug, Release and on web.
 *
 * This is the *JavaScript* half of the version, and it is rebundled on every
 * run. The native half — `CFBundleShortVersionString`, what iOS and the Settings
 * pane report — is stamped into `ios/Info.plist` when `expo prebuild` runs, and
 * nothing regenerates it afterwards. Bump the version without re-running
 * prebuild and the sidebar will happily show a version the phone disagrees with.
 *
 * Bumped by hand with every feature — see "Versioning" in CLAUDE.md.
 */
export const APP_VERSION: string = appJson.expo.version;

/** How the version is written wherever it is shown. */
export const VERSION_LABEL = `v${APP_VERSION}`;
