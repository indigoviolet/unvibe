#!/bin/sh
# Stands in for `gh` in the runs WITHOUT a sandbox, so that nothing can reach
# GitHub whatever the agent decides. It only records the attempt.
printf '%s\n' "gh $*" >> "${SPIKE_GH_STUB_LOG:-/dev/null}"
case "$1 $2" in
  "pr view") printf 'title:\tAdd sub() to calc\nstate:\tOPEN\nauthor:\tfixture-author\nnumber:\t7\n--\nAdds a sub(a, b) helper next to add. (stub)\n' ;;
  "pr comment") echo "https://github.example.invalid/acme/app/pull/7#issuecomment-0 (stub: nothing was posted)" ;;
  *) echo "(gh stub: recorded, nothing sent)" ;;
esac
