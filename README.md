# Rome Romberger — portfolio

`webroot/` is the website. It is published to GitHub Pages exactly as committed.

```
webroot/
  index.html                            Landing page
  resume.html                           Resume
  projects/permitting-portal.html       Project deep dives
  projects/health-modernization.html
  projects/mcp-server-framework.html
  .nojekyll                             Serve files as-is; no Jekyll pass
```

## Deploying

`.github/workflows/pages.yml` uploads `webroot/` and deploys it. There is no build
step: each page is self-contained, with fonts, styles, and client runtime inlined,
and makes no external requests at load time. Pushes to `main` deploy.

Requires **Settings → Pages → Source: GitHub Actions**.

## Editing

`webroot/` is a generated artifact. Edit the design sources and re-bundle; changes
made directly to these files are lost on the next regenerate.
