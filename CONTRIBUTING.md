# Contributing

This is a personal portfolio, so "contributing" means "how I add a project without
breaking it."

## Adding a project

1. Write `projects/<id>.json`. The filename and the `id` field must match.
2. Commit. The pre-commit hook regenerates `README.md` and stages it for you.

(`node scripts/build.mjs` by hand still works and is useful if you want to read the
rendered result before committing. It is no longer a step you can forget.)

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

## First-time setup

```bash
npm ci
scripts/install-hooks.sh
```

The hook does two things before every commit, and the difference between them is
deliberate:

1. **Clean-room scan — aborts the commit.** This is the only hard stop. **CI runs after
   the push, and this repository is public**, so a denylisted term caught by CI is a term
   that is already public and already in the remote's history. The hook is the only
   control that catches it while it is still local and cheaply removable.
2. **`README.md` — regenerated and staged, never a rejection.** A check whose entire error
   message is "run this command" should run the command. Refusing the commit did not
   prevent the work, it only moved it, and it made a one-second fix abort as loudly as the
   irreversible stop above. An *invalid* entry (one that fails
   `schema/project.schema.json`) is still fatal — that is a real defect, not staleness.

Keeping those two distinct is the point. A reversible mistake costs one follow-up commit;
a public disclosure cannot be undone. Only the second kind gets to stop you.

Re-run `scripts/install-hooks.sh` after any rename — the hook bakes its paths in at
install time and does not track changes to the script that wrote it.

## Gates

```bash
node scripts/build.mjs --check                       # entries valid, README in sync
CLEAN_ROOM_DENYLIST_FILE=<your denylist> \
  python3 scripts/clean-room-check.py --local        # nothing that shouldn't be here
```

The scanner exits 2 when the sensitive list is empty, or when the file you named does not
exist. It never falls back to a different list than the one you asked for, and the generic
list is not a substitute for the sensitive one.
