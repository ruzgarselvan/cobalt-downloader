#!/bin/sh
# Registers the yt-dlp helper (host.py) with Chromium-based browsers on macOS.
# Usage: ./native/install.sh <extension-id>
# The extension ID is shown on the extension's card in chrome://extensions.
# Run it again if you move this folder.
set -e

EXT_ID="$1"
if ! printf '%s' "$EXT_ID" | grep -Eq '^[a-p]{32}$'; then
  echo "Usage: $0 <extension-id>"
  echo "Copy the ID from the extension's card in chrome://extensions (32 letters a-p)."
  exit 1
fi

HOST_NAME="com.cobalt_downloader.ytdlp"
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/host.py"

registered=0
for browser in "Google/Chrome" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" \
               "Vivaldi" "Arc/User Data" "net.imput.helium"; do
  root="$HOME/Library/Application Support/$browser"
  [ -d "$root" ] || continue
  mkdir -p "$root/NativeMessagingHosts"
  cat > "$root/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "yt-dlp helper for Cobalt Downloader",
  "path": "$DIR/host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "Registered for $browser"
  registered=1
done

[ "$registered" = 1 ] || echo "No supported browser profile folder found."
command -v yt-dlp >/dev/null 2>&1 || PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp was not found. Install it with: brew install yt-dlp ffmpeg deno"
fi
echo "Done. Reload the extension in chrome://extensions."
