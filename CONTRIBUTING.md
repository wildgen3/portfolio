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

## The site

`npm ci` once, then:

```bash
node scripts/build.mjs          # regenerate README.md from projects/*.json
node scripts/build.mjs --site   # regenerate site/ (gitignored; CI builds and deploys it)
```

The README and the site are two renderers over the same data, so neither can drift from
the other. `site/` is not committed — `pages.yml` builds it from source on every push to
`main` and deploys to GitHub Pages.

Case studies render through `marked`; Mermaid blocks are lifted to `<pre class="mermaid">`
and rendered client-side. Tables scroll inside their own container so the page never
scrolls sideways on a phone.

`demo_url` and `api_url` are optional and null until something is actually deployed. A
dead demo link is worse than no demo link, and the schema validates both as URIs.

## Gates

```bash
node scripts/build.mjs --check                       # entries valid, README in sync
CLEAN_ROOM_DENYLIST_FILE=<your denylist> \
  python3 scripts/clean-room-check.py --local        # nothing that shouldn't be here
```

The scanner exits 2 when the sensitive list is empty, or when the file you named does not
exist. It never falls back to a different list than the one you asked for, and the generic
list is not a substitute for the sensitive one.
