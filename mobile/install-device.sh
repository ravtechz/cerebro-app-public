#!/usr/bin/env bash
#
# Build Cerebro Release and put it on the iPhone.
#
# Exists because `expo run:ios` cannot renew an expired provisioning profile: it
# never passes -allowProvisioningUpdates to xcodebuild, so the moment the free
# Personal Team's 7-day profile lapses every build dies with
#   "No profiles for 'com.example.cerebro' were found ... Automatic signing is
#    disabled and unable to generate a profile."
# This calls xcodebuild directly with that flag, which mints a fresh profile,
# then installs with devicectl.
#
#   EXPO_APPLE_TEAM_ID=<team-id> ./install-device.sh   build, install, report
#   ./install-device.sh --status   profile expiry + what the phone has, build nothing
#
# Environment:
#   EXPO_APPLE_TEAM_ID=...   signing team, required to build. Xcode > Settings >
#                            Accounts > your Apple ID > Team, or the 10-character
#                            ID in the Apple Development certificate.
#   DEVICE=...               devicectl identifier, when more than one is paired
#
# The last step cannot be automated. iOS requires the developer certificate to
# be trusted by hand once a new profile is issued:
#   Settings > General > VPN & Device Management > Apple Development: ... > Trust
# The script recognises that specific launch refusal and says so, instead of
# reporting it as a build failure.
#
# Release, not Debug, on purpose: Debug keeps no JS inside the app and fetches
# the bundle from Metro at launch, so it only works while the Mac is awake and
# reachable. Release embeds main.jsbundle and works on cellular.
#
# A version bump still needs `npx expo prebuild -p ios` first — see CLAUDE.md.
# This script only warns when app.json and ios/Info.plist have drifted apart.

set -euo pipefail

TEAM_ID="${EXPO_APPLE_TEAM_ID:-}"
SCHEME="Cerebro"
CONFIG="Release"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$HERE/ios/$SCHEME.xcworkspace"
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$HERE/ios" ] || die "ios/ is missing — run 'npx expo prebuild -p ios' first"
[ -d "$WORKSPACE" ] || die "$WORKSPACE not found"

BUNDLE_ID="$(python3 -c "import json;print(json.load(open('$HERE/app.json'))['expo']['ios']['bundleIdentifier'])")"
APP_VERSION="$(python3 -c "import json;print(json.load(open('$HERE/app.json'))['expo']['version'])")"

# --------------------------------------------------------------------------
# Prints "<expiry ISO>  <valid|EXPIRED>" for every cached profile of this app.
profiles() {
  python3 - "$PROFILE_DIR" "$BUNDLE_ID" <<'PY'
import datetime, glob, os, plistlib, subprocess, sys
directory, bundle_id = sys.argv[1], sys.argv[2]
now = datetime.datetime.now(datetime.timezone.utc)
found = False
for path in sorted(glob.glob(os.path.join(directory, "*.mobileprovision"))):
    raw = subprocess.run(["security", "cms", "-D", "-i", path], capture_output=True).stdout
    try:
        plist = plistlib.loads(raw)
    except Exception:
        continue
    if bundle_id.lower() not in plist.get("Entitlements", {}).get("application-identifier", "").lower():
        continue
    found = True
    expiry = plist.get("ExpirationDate")
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=datetime.timezone.utc)
    left = (expiry - now).days if expiry else None
    state = "EXPIRED" if expiry and expiry < now else f"valid, {left} day(s) left"
    print(f"  {expiry:%Y-%m-%d %H:%M} UTC   {state}")
if not found:
    print("  none cached — the build will mint one")
PY
}

# devicectl speaks its own identifier, not the hardware UDID.
find_device() {
  if [ -n "${DEVICE:-}" ]; then echo "$DEVICE"; return; fi
  local json; json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || die "devicectl failed — is Xcode installed?"
  python3 - "$json" <<'PY'
import json, sys
devices = json.load(open(sys.argv[1]))["result"]["devices"]
usable = [
    d for d in devices
    if d.get("connectionProperties", {}).get("pairingState") == "paired"
    and d.get("connectionProperties", {}).get("tunnelState") != "unavailable"
]
if not usable:
    sys.exit("ERROR: no paired iPhone is reachable — unlock it and check Wi-Fi/USB")
if len(usable) > 1:
    for d in usable:
        print(d["identifier"], d.get("deviceProperties", {}).get("name", "?"), file=sys.stderr)
    sys.exit("ERROR: more than one device; pick one with DEVICE=<identifier>")
print(usable[0]["identifier"])
PY
  rm -f "$json"
}

# --------------------------------------------------------------------------
if [ "${1:-}" = "--status" ]; then
  echo "==> app.json version: $APP_VERSION   ($BUNDLE_ID)"
  echo "==> cached provisioning profiles"
  profiles
  echo "==> on the phone"
  device="$(find_device)"
  xcrun devicectl device info apps --device "$device" 2>/dev/null \
    | grep -iE "Bundle Identifier|$BUNDLE_ID" || echo "  not installed"
  exit 0
fi

[ -n "$TEAM_ID" ] || die "set EXPO_APPLE_TEAM_ID to your Apple signing team, e.g. EXPO_APPLE_TEAM_ID=ABCDE12345 ./install-device.sh"

# The trap this catches shipped once already, on v1.1.0: CFBundleShortVersionString
# is stamped at prebuild time, so bumping app.json without re-running prebuild
# makes the sidebar and iOS disagree about which version this is.
PLIST_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$HERE/ios/$SCHEME/Info.plist" 2>/dev/null || echo '?')"
if [ "$PLIST_VERSION" != "$APP_VERSION" ]; then
  echo "WARNING: app.json says $APP_VERSION but ios/Info.plist says $PLIST_VERSION."
  echo "         Run 'npx expo prebuild -p ios' or the app will lie about itself."
  echo
fi

echo "==> profiles before the build"
profiles

echo "==> building $SCHEME ($CONFIG, team $TEAM_ID)"
# Quiet while it works, loud when it breaks: the whole log goes to a file and
# only the signing summary is echoed, unless xcodebuild fails — in which case
# the tail is the only thing worth reading.
BUILD_LOG="$(mktemp -t cerebro-build)"
# Generic destination, not the phone: with `-destination id=<udid>` xcodebuild
# waits for the developer disk image to mount and dies with "could not be
# mounted" whenever the phone is locked — while signing needs no device at all.
if ! xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  build \
  </dev/null >"$BUILD_LOG" 2>&1
then
  echo
  tail -n 40 "$BUILD_LOG"
  echo
  die "build failed — full log at $BUILD_LOG"
fi
grep -E "^ +(Signing Identity|Provisioning Profile):" "$BUILD_LOG" | sed 's/^ */  /' || true
echo "  build OK   (log: $BUILD_LOG)"

BUILT_DIR="$(xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "generic/platform=iOS" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ BUILT_PRODUCTS_DIR = /{print $2; exit}')"
APP="$BUILT_DIR/$SCHEME.app"
[ -d "$APP" ] || die "build reported success but $APP is missing"

echo "==> verifying the bundle"
# A successful build is not an installable one: expo's prebuilt XCFrameworks can
# come out unsigned, and the device then rejects the whole bundle with
# ApplicationVerificationFailed. Catch it here rather than on the phone.
codesign -v --deep --strict "$APP" || die "code signature is not valid — see CLAUDE.md on signing the XCFrameworks"
echo "  signature OK   version $(plutil -extract CFBundleShortVersionString raw -o - "$APP/Info.plist")"
security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null \
  | plutil -p - | grep -i ExpirationDate | sed 's/^/  /'

DEVICE_ID="$(find_device)"
echo "==> installing on $DEVICE_ID"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP" | grep -E "App installed|bundleID" | sed 's/^/  /'

echo "==> launching"
if launch_output="$(xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1)"; then
  echo "  running."
  exit 0
fi

# The install is the part that matters; these two refusals are about the state
# of the phone in this moment, not about the build, so neither is a failure.
if grep -q "explicitly trusted by the user" <<<"$launch_output"; then
  cat <<'MSG'

  Installed. iOS will not open it until the certificate is trusted, which is
  expected after a new profile is issued and cannot be done from the Mac:

      Settings > General > VPN & Device Management
        > Apple Development: <your apple id> > Trust

  Then open Cerebro normally.
MSG
  exit 0
fi

if grep -q "could not be, unlocked" <<<"$launch_output"; then
  echo
  echo "  Installed. The phone is locked, so it could not be opened from here —"
  echo "  unlock it and tap Cerebro."
  exit 0
fi

echo "$launch_output" | tail -n 15
die "installed, but the app refused to launch for an unexpected reason"
