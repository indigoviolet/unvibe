#!/bin/bash
# Build the scratch layout the spike runs in. Everything lives under $SPIKE_DIR;
# nothing is written anywhere else.
#   setup-scratch.sh            fixtures, stub gh, config (no logins)
#   setup-scratch.sh --logins   also COPY the agent logins into the scratch HOME
#                               (needed for live runs only; delete afterwards)
set -eu
: "${SPIKE_DIR:?set SPIKE_DIR to a scratch directory you created}"
here=$(cd "$(dirname "$0")" && pwd)
D=$SPIKE_DIR
G="git -c user.name=fixture -c user.email=fixture@example.invalid"
/bin/rm -rf "$D/fx/checkout" "$D/fx/outside"
mkdir -p "$D/fx/checkout" "$D/fx/outside" "$D/home2/.ssh" "$D/home2/.config" "$D/home2/.local/state" "$D/stub-bin"
( cd "$D/fx/checkout"
  git init -q -b main .
  printf 'def add(a, b):\n    return a + b\n' > calc.py
  $G add . && $G commit -q -m "add calc"
  printf 'def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n' > calc.py
  $G commit -qam "add sub" )
echo "outside-file" > "$D/fx/outside/note.txt"
echo "FAKE-HOME-SECRET-7731" > "$D/home2/secret.txt"
echo "FAKE-SSH-KEY-9912" > "$D/home2/.ssh/id_ed25519"
: > "$D/fx/gh-stub.log"
cp "$here/gh-stub.sh" "$D/stub-bin/gh"
real() { command -v "$1" >/dev/null 2>&1 && readlink -f "$(command -v "$1")" || echo ""; }
# nono binds a unix socket under TMPDIR and a socket path is limited to 108
# bytes, so the agent's temp/scratch directory needs a short path of its own.
# Reused across resets; remove it with the rest at the end.
SHORT=${SPIKE_SHORT_TMP:-}
[ -z "$SHORT" ] && [ -f "$D/short-tmp-path" ] && SHORT=$(cat "$D/short-tmp-path")
[ -z "$SHORT" ] && SHORT=$(mktemp -d /tmp/uvsp-XXXXXX)
mkdir -p "$SHORT" "$D/profiles"; echo "$SHORT" > "$D/short-tmp-path"
cat > "$D/spike-config.json" <<JSON
{
  "realClaude": "$(real claude)",
  "realCodex": "$(real codex)",
  "realGhDir": "$(dirname "$(real gh)")",
  "fakeGhToken": "ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0000",
  "shortTmp": "$SHORT"
}
JSON
if [ "${1:-}" = "--logins" ]; then
  mkdir -p "$D/home2/.claude" "$D/home2/.codex"
  # Linux keeps both logins in files. On macOS Claude Code uses the Keychain,
  # so there is no file to copy and the Claude runs need a Keychain grant.
  for f in .claude/.credentials.json .codex/auth.json; do
    if [ -f "$HOME/$f" ]; then cp "$HOME/$f" "$D/home2/$f" && chmod 600 "$D/home2/$f" && echo "copied $f into $D/home2 (delete after the live runs)"
    else echo "no $HOME/$f to copy"; fi
  done
fi
echo "scratch ready: $D"
