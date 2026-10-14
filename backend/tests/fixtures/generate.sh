#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)"
TUBELITE_ROOT="${TUBELITE_ROOT:-$REPO_ROOT/../youtube_app_no_qc}"
APK_SOURCE="$TUBELITE_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="$SCRIPT_DIR/generated/tubelite-debug.apk"

if [ ! -x "$TUBELITE_ROOT/android/gradlew" ]; then
  echo "TubeLite Gradle wrapper not found at $TUBELITE_ROOT/android/gradlew" >&2
  exit 1
fi

(
  cd "$TUBELITE_ROOT/android"
  ./gradlew :app:assembleDebug
)
mkdir -p "$(dirname -- "$APK_DEST")"
cp "$APK_SOURCE" "$APK_DEST"
printf 'Generated ignored APK fixture: %s\n' "$APK_DEST"
