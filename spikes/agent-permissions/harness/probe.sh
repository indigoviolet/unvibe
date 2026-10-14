#!/bin/bash
# Runs INSIDE the sandbox (or bare, for the baseline): one line per action.
D="$1"; FAKE_PORT="$2"; REAL_GH="$3"; OTHER_PORT="$4"
t() { local name="$1"; shift; out=$("$@" 2>&1); rc=$?; printf '%-34s rc=%-3s %s\n' "$name" "$rc" "$(printf '%s' "$out" | head -c 230 | tr '\n' '|')"; }
R=acme-fixture-does-not-exist-91c3/app
t "git log"                    git log --oneline -n 2
t "read file in checkout"      cat calc.py
t "edit in checkout"           bash -c 'echo "# edit" >> calc.py && echo wrote'
t "new file in checkout"       bash -c 'echo x > NEWFILE && echo wrote'
t "edit outside checkout"      bash -c "echo x >> $D/fx/outside/note.txt && echo wrote"
t "read outside checkout"      cat "$D/fx/outside/note.txt"
t "read home file"             cat "$HOME/secret.txt"
t "read home .ssh key"         cat "$HOME/.ssh/id_ed25519"
t "write agent scratch dir"    bash -c 'echo x > "$TMPDIR/probe.$$" && echo wrote && /bin/rm -f "$TMPDIR/probe.$$"'
t "web fetch (curl https)"     curl -sS -m 15 -o /dev/null -w '%{http_code}' https://example.com
t "token visible to agent"     bash -c 'echo "UNVIBE_GH_TOKEN=${UNVIBE_GH_TOKEN:-<unset>} GH_TOKEN=${GH_TOKEN:-<unset>}"'
t "gh pr view (read)"          gh pr view 7 -R $R
t "gh api GET (read)"          gh api repos/$R/pulls/7
t "gh pr comment (write)"      gh pr comment 7 -R $R --body "hello from the agent"
t "gh pr review --approve"     gh pr review 7 -R $R --approve
t "gh pr merge"                gh pr merge 7 -R $R
t "gh api -X POST"             gh api -X POST repos/$R/issues/7/comments -f body=hi
t "gh api -f (implicit POST)"  gh api repos/$R/issues/7/comments -f body=hi
t "gh api graphql (mutation)"  gh api graphql -f query='mutation { __typename }'
t "gh auth token"              gh auth token
t "real gh by absolute path"   "$REAL_GH" pr comment 7 -R $R --body hi
t "loopback: allowed port"     curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FAKE_PORT/repos/acme/app"
t "loopback: a port not granted" curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$OTHER_PORT/repos/acme/app"
t "unix socket: system D-Bus"  python3 -I -S -c 'import socket;s=socket.socket(socket.AF_UNIX);s.connect("/run/dbus/system_bus_socket");print("connected")'
