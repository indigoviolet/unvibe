#!/bin/bash
# Start-up and per-command cost of nono, no agent and no tokens involved.
#   SPIKE_DIR=<scratch> timing.sh <profile.json>
set -u
D=$SPIKE_DIR; PROFILE=$1; N=${N:-15}
GHD=$(python3 -I -c "import json;print(json.load(open('$D/spike-config.json'))['realGhDir'])")
TMPD=$(python3 -I -c "import json;print(json.load(open('$D/spike-config.json'))['shortTmp'])")
E=(env -i HOME=$D/home2 UNVIBE_GH_TOKEN=fake PATH=$D/bin:$GHD:/usr/bin:/bin TMPDIR=$TMPD)
NONO=("${E[@]}" $D/bin/nono run -s --no-diagnostics --no-rollback --profile "$PROFILE" --allow-cwd)
med() { # median wall ms of N runs of "$@"
  for _ in $(seq "$N"); do s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e - s) / 1000000 )); done | sort -n | awk '{a[NR]=$1} END{printf "median %d ms (min %d, max %d, n=%d)\n", a[int((NR+1)/2)], a[1], a[NR], NR}'
}
cd "$D/fx/checkout"
"${NONO[@]}" -- /usr/bin/true || { echo "nono does not start with this profile; fix that first" >&2; exit 1; }
uptime | sed 's/.*load/load/'
printf '%-52s' "plain: /usr/bin/true";                         med "${E[@]}" /usr/bin/true
printf '%-52s' "nono run … -- /usr/bin/true (session start)";  med "${NONO[@]}" -- /usr/bin/true
printf '%-52s' "nono, filesystem-only profile -- true";        med "${E[@]}" $D/bin/nono run -s --no-diagnostics --no-rollback --profile "$D/profiles/fsonly.json" --allow-cwd -- /usr/bin/true
printf '%-52s' "plain: 20x git log in one shell";              med "${E[@]}" /usr/bin/bash -c 'for i in $(seq 20); do git log --oneline -n 2; done'
printf '%-52s' "nono:  20x git log in one sandbox";            med "${NONO[@]}" -- /usr/bin/bash -c 'for i in $(seq 20); do git log --oneline -n 2; done'
printf '%-52s' "plain: 20x gh search --help";                  med "${E[@]}" /usr/bin/bash -c 'for i in $(seq 20); do gh search --help; done'
printf '%-52s' "nono:  20x gh search --help (mediated)";       med "${NONO[@]}" -- /usr/bin/bash -c 'for i in $(seq 20); do gh search --help; done'
printf '%-52s' "nono:  20x gh pr comment (refused)";           med "${NONO[@]}" -- /usr/bin/bash -c 'for i in $(seq 20); do gh pr comment 1 --body x; done'
