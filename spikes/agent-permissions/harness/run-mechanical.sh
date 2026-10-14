#!/bin/bash
# The action list without any agent or tokens: bare, then under nono with the
# Unvibe profile. Also the credential-proxy method/path check against the
# local fake GitHub. Needs setup-scratch.sh to have run.
#   SPIKE_DIR=<scratch> run-mechanical.sh
set -u
here=$(cd "$(dirname "$0")" && pwd); D=$SPIKE_DIR
cfg() { python3 -I -c "import json;print(json.load(open('$D/spike-config.json'))['$1'])"; }
GHD=$(cfg realGhDir); TMPD=$(cfg shortTmp); TOKEN=$(cfg fakeGhToken)
PORT=$(python3 -I -c 'import random;print(random.randint(20000,45000))')
node "$here/fake-github.mjs" "$PORT" "$D/fx/fake-github.log" "$TOKEN" > "$D/fx/fake-github.out" 2>&1 &
FAKE_PID=$!
# A second listener on a port the sandbox is NOT given, to show loopback is closed by default.
PORT2=$((PORT + 7)); node "$here/fake-github.mjs" "$PORT2" "$D/fx/fake-github2.log" > /dev/null 2>&1 &
FAKE2_PID=$!; trap 'kill $FAKE_PID $FAKE2_PID 2>/dev/null' EXIT; sleep 1
E=(env -i HOME=$D/home2 UNVIBE_GH_TOKEN=$TOKEN PATH=$D/bin:$GHD:/usr/bin:/bin TMPDIR=$TMPD)
cd "$D/fx/checkout"
echo "== bare (no sandbox; gh is the stub) =="
env -i HOME=$D/home2 UNVIBE_GH_TOKEN=$TOKEN PATH=$D/stub-bin:/usr/bin:/bin TMPDIR=$TMPD SPIKE_GH_STUB_LOG=/dev/null bash "$here/probe.sh" "$D" "$PORT" "$D/stub-bin/gh" "$PORT2"
SPIKE_DIR=$D bash "$here/setup-scratch.sh" > /dev/null; cd "$D/fx/checkout"
echo; echo "== nono, policy/unvibe-claude.json =="
"${E[@]}" "$D/bin/nono" run -s --no-diagnostics --no-rollback --profile "$here/../policy/unvibe-claude.json" --allow-cwd \
  --read "$here" --allow "$TMPD" --open-port "$PORT" -- /bin/bash "$here/probe.sh" "$D" "$PORT" "$GHD/gh" "$PORT2"
echo; echo "checkout after the sandboxed run: $(git status --short | wc -l) changed files; outside note: $(tr '\n' ' ' < "$D/fx/outside/note.txt")"

echo; echo "== credential proxy against the fake GitHub (method/path rules, stand-in token) =="
python3 -I - "$here/../policy/unvibe-claude.json" "$D/profiles/proxytest.json" "$PORT" "$D/fx/fake-token-file" <<'PY'
import json, sys
src, dst, port, tokfile = sys.argv[1:5]
p = json.load(open(src)); cp = p["command_policies"]
ep = cp["commands"]["gh"]["from"]["session"]["sandbox"]["credentials"][0]["endpoint_policy"]
cp["credentials"]["fake-api"] = {"type": "proxy", "upstream": "http://127.0.0.1:%s" % port, "credential_key": "file://" + tokfile,
    "env_var": "FAKE_TOKEN", "base_url_env_var": "FAKE_API_URL", "inject_header": "Authorization", "credential_format": "token {}"}
cp["commands"]["apicurl"] = {"executable": "/usr/bin/curl", "from": {"session": {"sandbox": {"fs_read": ["."], "credentials": [{"name": "fake-api", "endpoint_policy": ep}]}}}}
json.dump(p, open(dst, "w"), indent=2)
PY
printf '%s' "$TOKEN" > "$D/fx/fake-token-file"; : > "$D/fx/fake-github.log"
"${E[@]}" "$D/bin/nono" run -s --no-diagnostics --no-rollback --profile "$D/profiles/proxytest.json" --allow-cwd --read "$here" --allow "$TMPD" -- /bin/bash -c '
t() { local name="$1"; shift; out=$("$@" 2>&1); rc=$?; printf "%-34s rc=%-3s %s\n" "$name" "$rc" "$(printf "%s" "$out" | head -c 160 | tr "\n" "|")"; }
c() { apicurl -sS -m 10 -w " [http %{http_code}]" --variable %FAKE_API_URL --variable %FAKE_TOKEN --expand-header "Authorization: Bearer {{FAKE_TOKEN}}" "$@"; }
t "GET pull request"            c --expand-url "{{FAKE_API_URL}}/repos/acme/app/pulls/7"
t "POST issue comment"          c -X POST -d "{\"body\":\"hi\"}" --expand-url "{{FAKE_API_URL}}/repos/acme/app/issues/7/comments"
t "DELETE repo"                 c -X DELETE --expand-url "{{FAKE_API_URL}}/repos/acme/app"
t "POST /graphql with mutation" c -X POST -d "{\"query\":\"mutation { x }\"}" --expand-url "{{FAKE_API_URL}}/graphql"
'
echo "what reached the fake GitHub:"; sed 's/^/  /' "$D/fx/fake-github.log"
