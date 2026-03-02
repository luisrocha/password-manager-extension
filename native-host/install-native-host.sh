#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_TEMPLATE="$ROOT_DIR/com.password_manager.json"
HOST_PATH="$ROOT_DIR/host.js"
LAUNCHER_PATH="$ROOT_DIR/host-launcher.sh"
TARGET_DIR="${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"

if [[ ! -f "$MANIFEST_TEMPLATE" ]]; then
  echo "Manifest template not found: $MANIFEST_TEMPLATE" >&2
  exit 1
fi

if [[ -z "${EXTENSION_ID:-}" ]]; then
  echo "Set EXTENSION_ID before running this script." >&2
  echo "Example: EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop ./install-native-host.sh" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
TMP_MANIFEST="$(mktemp)"

sed \
  -e "s|/ABSOLUTE/PATH/TO/password-manager-extension/native-host/host.js|${LAUNCHER_PATH}|g" \
  -e "s|REPLACE_WITH_EXTENSION_ID|${EXTENSION_ID}|g" \
  "$MANIFEST_TEMPLATE" > "$TMP_MANIFEST"

cp "$TMP_MANIFEST" "$TARGET_DIR/com.password_manager.json"
rm "$TMP_MANIFEST"

chmod 755 "$HOST_PATH"
chmod 755 "$LAUNCHER_PATH"

echo "Installed native host manifest to: $TARGET_DIR/com.password_manager.json"
