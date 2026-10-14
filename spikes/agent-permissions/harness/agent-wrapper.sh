#!/bin/sh
# The executable path Unvibe would hand to the ACP adapter (CLAUDE_CODE_EXECUTABLE
# / CODEX_PATH) in place of the real CLI: it runs the real CLI under nono.
#
# Environment (set by the service when it spawns the adapter):
#   UNVIBE_NONO_BIN       absolute path of nono
#   UNVIBE_NONO_PROFILE   absolute path of the profile JSON
#   UNVIBE_REAL_AGENT     absolute path of the real claude / codex executable
#   UNVIBE_AGENT_SCRATCH  a directory the agent may write to (never the checkout)
#   UNVIBE_READ_ROOT      optional: extra read-only root (Codex: the worktrees dir,
#                         because one `codex app-server` serves every session)
#   UNVIBE_MCP_PORT       port of Unvibe's review MCP server on 127.0.0.1
#   UNVIBE_GH_TOKEN       the GitHub token; nono keeps it, the agent never sees it
#   UNVIBE_NONO_EXTRA     optional extra nono flags (spike experiments)
set -eu
: "${UNVIBE_NONO_BIN:?}" "${UNVIBE_NONO_PROFILE:?}" "${UNVIBE_REAL_AGENT:?}" "${UNVIBE_AGENT_SCRATCH:?}"
bindir=$(dirname "$UNVIBE_REAL_AGENT")
set -- -- "$UNVIBE_REAL_AGENT" "$@"
[ -n "${UNVIBE_MCP_PORT:-}" ] && set -- --open-port "$UNVIBE_MCP_PORT" "$@"
[ -n "${UNVIBE_READ_ROOT:-}" ] && set -- --read "$UNVIBE_READ_ROOT" "$@"
# shellcheck disable=SC2086
exec "$UNVIBE_NONO_BIN" run --silent --no-diagnostics --no-rollback \
  --profile "$UNVIBE_NONO_PROFILE" --allow-cwd \
  --read "$bindir" --allow "$UNVIBE_AGENT_SCRATCH" \
  ${UNVIBE_NONO_EXTRA:-} "$@"
