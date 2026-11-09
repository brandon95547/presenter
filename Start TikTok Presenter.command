#!/bin/zsh
# Double-click to start TikTok Presenter. Keep the Terminal window open while you stream.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
PORT="${PORT:-7272}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and try again."
  read -k1 "?Press any key to close."
  exit 1
fi

# Already running? Just open the Presenter View.
if curl -s -o /dev/null "http://localhost:$PORT/api/library"; then
  open "http://localhost:$PORT/presenter"
  exit 0
fi

(sleep 1 && open "http://localhost:$PORT/presenter") &
exec node server.js
