# Contributing

This is a personal portfolio, so "contributing" means "how I add a project without
breaking it."

## Adding a project

1. Write `projects/<id>.json`. The filename and the `id` field must match.
2. `node scripts/build.mjs` — regenerates `README.md`.
3. Commit both.

`projects/*.json` is the source of truth. `README.md` is **generated** and diff-gated in
CI, so hand-editing it will fail the build.

## The two fields that do structural work

**`capabilities`** is a closed enum. New values require editing
`schema/project.schema.json`, deliberately — every project must be tagged against the
positioning, so this page stays a positioning document rather than drifting into a list
of things I happened to build.

**`confidentiality`** drives rendering. A `clean-room` value makes the build emit a
standard disclaimer into both the README entry and the case-study header, so the boundary
is applied by tooling rather than remembered.

## Gates

```bash
node scripts/build.mjs --check                       # entries valid, README in sync
CLEAN_ROOM_DENYLIST_FILE=<your denylist> \
  python3 scripts/clean-room-check.py --local        # nothing that shouldn't be here
```

The scanner exits 2 rather than 0 when no terms are configured. It refuses to report a
pass without having checked anything.
