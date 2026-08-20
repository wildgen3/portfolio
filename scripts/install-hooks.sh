#!/usr/bin/env bash
# Install the pre-commit hook.
#
# This repository is public and is the hub other things link to. Its CI is correct,
# but CI runs AFTER the push -- and on a public repo a denylisted term caught by CI
# is a term that is already public and already in the remote's history. The
# pre-commit hook is the only control that catches it while it is still local and
# cheaply removable.
#
# Idempotent. Re-run it after any rename: the hook is written with paths baked in at
# install time and does not track changes to this script.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DENYLIST="$HOME/.config/permitportal/denylist.txt"

if [[ ! -f "$DENYLIST" ]]; then
  echo "No denylist at $DENYLIST." >&2
  echo "Create it, or run scripts/install-hooks.sh in the permitportal repo first —" >&2
  echo "both repositories deliberately share one list." >&2
  exit 1
fi

cat > "$REPO/.git/hooks/pre-commit" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
REPO="\$(git rev-parse --show-toplevel)"
export CLEAN_ROOM_DENYLIST_FILE="$DENYLIST"

# --local prints file and line. Safe here: the tree is not yet public at commit time.
python3 "\$REPO/scripts/clean-room-check.py" --local || {
  echo
  echo "pre-commit: clean-room check failed. Commit aborted."
  echo "Override only if you are certain: git commit --no-verify"
  exit 1
}

# README.md is generated from projects/*.json and byte-diff-gated in CI. Catching
# drift here saves a round trip; it needs no node_modules because build.mjs only
# imports marked inside the --site path.
node "\$REPO/scripts/build.mjs" --check || {
  echo
  echo "pre-commit: README.md is stale or a project entry is invalid."
  echo "Run: node scripts/build.mjs"
  exit 1
}
HOOK
chmod +x "$REPO/.git/hooks/pre-commit"
echo "Installed pre-commit hook -> $REPO/.git/hooks/pre-commit"
echo "  clean-room scan (--local) + generated-README drift check"
