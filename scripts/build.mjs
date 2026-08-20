#!/usr/bin/env node
/**
 * Portfolio build.
 *
 * projects/*.json is the single source of truth. README.md is GENERATED from it and
 * diff-gated in CI, so the two can never disagree. This is the same pattern the
 * PermitPortal repo uses for its LinkML-generated artifacts, applied here.
 *
 *   node scripts/build.mjs           write README.md
 *   node scripts/build.mjs --check   fail if README.md is stale, or any entry is invalid
 *
 * Validation is hand-rolled against schema/project.schema.json rather than pulling in
 * ajv: the schema uses a small, fixed subset of JSON Schema, and a portfolio that needs
 * a node_modules directory to render its own README is a portfolio that stops rendering.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = JSON.parse(readFileSync(join(REPO, "schema", "project.schema.json"), "utf8"));

const CAPABILITY_LABELS = {
  "deployment-architecture": "Deployment architecture",
  "workload-transition": "Workload transition",
  "technical-blocker-resolution": "Technical blocker resolution",
  "cross-functional-technical-leadership": "Cross-functional technical leadership",
  "evaluation-and-measurement": "Evaluation and measurement",
  "platform-modernization": "Platform modernisation",
};

const DISCLAIMER =
  "> Built clean-room from public sources. It reproduces no client system, contains no " +
  "client data, and names no client. Every substantive claim traces to a public citation.";

const errors = [];

/** Validate one entry against the subset of JSON Schema this file actually uses. */
function validate(id, obj) {
  const where = `projects/${id}.json`;
  const props = SCHEMA.properties;

  for (const req of SCHEMA.required) {
    if (obj[req] === undefined) errors.push(`${where}: missing required field '${req}'`);
  }
  for (const key of Object.keys(obj)) {
    if (!props[key]) errors.push(`${where}: unknown field '${key}' (additionalProperties is false)`);
  }
  for (const [key, value] of Object.entries(obj)) {
    const spec = props[key];
    if (!spec || value === null || value === undefined) continue;

    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`${where}: '${key}' = '${value}' is not one of: ${spec.enum.join(", ")}`);
    }
    if (spec.pattern && typeof value === "string" && !new RegExp(spec.pattern).test(value)) {
      errors.push(`${where}: '${key}' does not match ${spec.pattern}`);
    }
    if (spec.maxLength && typeof value === "string" && value.length > spec.maxLength) {
      errors.push(`${where}: '${key}' exceeds ${spec.maxLength} characters (${value.length})`);
    }
    if (spec.type === "array" && Array.isArray(value)) {
      if (spec.minItems && value.length < spec.minItems) {
        errors.push(`${where}: '${key}' needs at least ${spec.minItems} item(s)`);
      }
      const itemEnum = spec.items?.enum;
      if (itemEnum) {
        for (const item of value) {
          if (!itemEnum.includes(item)) {
            errors.push(`${where}: '${key}' contains '${item}', which is not an allowed value`);
          }
        }
      }
    }
  }

  // A declared case study must exist. A dead promise is worse than no promise.
  if (obj.case_study && !existsSync(join(REPO, obj.case_study))) {
    errors.push(`${where}: case_study points at ${obj.case_study}, which does not exist`);
  }
}

const projects = [];
for (const file of readdirSync(join(REPO, "projects")).sort()) {
  if (!file.endsWith(".json")) continue;
  const id = file.replace(/\.json$/, "");
  let obj;
  try {
    obj = JSON.parse(readFileSync(join(REPO, "projects", file), "utf8"));
  } catch (e) {
    errors.push(`projects/${file}: invalid JSON — ${e.message}`);
    continue;
  }
  if (obj.id !== id) errors.push(`projects/${file}: 'id' is '${obj.id}' but the filename says '${id}'`);
  validate(id, obj);
  projects.push(obj);
}

if (errors.length) {
  console.error("portfolio: FAILED\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

projects.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

function entry(p) {
  const caps = p.capabilities.map((c) => `\`${CAPABILITY_LABELS[c] ?? c}\``).join(" · ");
  const lines = [
    `### [${p.name}](${p.repo})`,
    "",
    `**${p.tagline}**`,
    "",
    p.problem,
    "",
  ];
  if (p.outcome) lines.push(`**Outcome.** ${p.outcome}`, "");
  if (p.confidentiality === "clean-room") lines.push(DISCLAIMER, "");
  lines.push(`${caps}`, "");
  lines.push(`<sub>${p.role} · ${p.stack.join(", ")} · \`${p.status}\`${p.phase ? ` · \`${p.phase}\`` : ""}</sub>`, "");
  if (p.artifacts?.length) {
    lines.push("Start here:", "");
    for (const a of p.artifacts) lines.push(`- [${a.label}](${a.url})`);
    lines.push("");
  }
  if (p.case_study) lines.push(`[Read the case study →](${p.case_study})`, "");
  return lines.join("\n");
}

const featured = projects.filter((p) => p.featured);
const rest = projects.filter((p) => !p.featured);

const body = `<!-- GENERATED by scripts/build.mjs from projects/*.json — do not edit. -->
# Rome Romberger

Cloud architecture and deployment engineering. I take systems that work in a demo and
make them work in someone else's environment — which is usually a different problem.

Each project below is tagged against the capability it actually demonstrates. The tags
are a closed set validated in CI, so this page cannot quietly become a list of hobbies.

---

## Selected work

${featured.map(entry).join("\n---\n\n")}
${rest.length ? `---\n\n## Also\n\n${rest.map(entry).join("\n")}` : ""}
---

## How this page works

\`projects/*.json\` is the source of truth; this README is generated from it by
\`scripts/build.mjs\` and diff-gated in CI. The two cannot disagree, and a project entry
that fails \`schema/project.schema.json\` fails the build.

Licensed [CC-BY-4.0](LICENSE).
`;

// ---------------------------------------------------------------------------
// Static site. Same data, second renderer -- so the README and the site cannot
// disagree about anything, because neither is written by hand.
// ---------------------------------------------------------------------------
async function buildSite() {
  const { marked } = await import("marked");
  marked.setOptions({ gfm: true, breaks: false });

  const template = readFileSync(join(REPO, "templates", "page.html"), "utf8");
  const SITE = join(REPO, "site");
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(join(SITE, "case-studies"), { recursive: true });

  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Wide blocks scroll inside their own container rather than the page.
  const wrapWide = (html) =>
    html.replace(/<table>/g, '<div class="scroll"><table>').replace(/<\/table>/g, "</table></div>");

  // Mermaid fences survive marked as <pre><code class="language-mermaid">.
  // Convert to the <pre class="mermaid"> the renderer expects.
  const liftMermaid = (html) =>
    html.replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
      (_, code) => `<pre class="mermaid">${code}</pre>`
    );

  const MERMAID_CDN =
    '<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";' +
    'const d=matchMedia("(prefers-color-scheme: dark)").matches;' +
    'm.initialize({startOnLoad:true,theme:d?"dark":"neutral",securityLevel:"strict"});<\/script>';

  const page = ({ title, description, body, footer, scripts = "" }) =>
    template
      .replace(/\{\{TITLE\}\}/g, esc(title))
      .replace(/\{\{DESCRIPTION\}\}/g, esc(description))
      .replace("{{BODY}}", body)
      .replace("{{FOOTER}}", footer)
      .replace("{{SCRIPTS}}", scripts);

  const FOOTER =
    'Generated from <code>projects/*.json</code>. ' +
    '<a href="https://github.com/wildgen3/portfolio">Source</a> \u00b7 ' +
    '<a href="https://creativecommons.org/licenses/by/4.0/">CC-BY-4.0</a>';

  // --- index ---------------------------------------------------------------
  const card = (p) => {
    const chips = p.capabilities
      .map((c) => `<li>${esc(CAPABILITY_LABELS[c] ?? c)}</li>`).join("");
    const links = [
      `<a href="${esc(p.repo)}">Repository</a>`,
      p.homepage ? `<a href="${esc(p.homepage)}">Live</a>` : "",
      p.demo_url ? `<a href="${esc(p.demo_url)}">Demo</a>` : "",
      p.api_url ? `<a href="${esc(p.api_url)}">API</a>` : "",
      p.case_study ? `<a href="${esc(p.case_study.replace(/\.md$/, ".html"))}">Case study</a>` : "",
    ].filter(Boolean).join(" \u00b7 ");
    const artifacts = (p.artifacts ?? []).length
      ? `<p class="meta">Start here: ${p.artifacts.map((a) => `<a href="${esc(a.url)}">${esc(a.label)}</a>`).join(" \u00b7 ")}</p>`
      : "";
    return `<section>
  <h2>${esc(p.name)}</h2>
  <p><strong>${esc(p.tagline)}</strong></p>
  <p>${esc(p.problem)}</p>
  ${p.outcome ? `<p><strong>Outcome.</strong> ${esc(p.outcome)}</p>` : ""}
  ${p.confidentiality === "clean-room" ? `<blockquote>${esc(DISCLAIMER.replace(/^&gt; ?/, ""))}</blockquote>` : ""}
  <ul class="chips">${chips}</ul>
  <p class="meta">${esc(p.role)} \u00b7 ${esc(p.stack.join(", "))} \u00b7 ${esc(p.status)}${p.phase ? " \u00b7 " + esc(p.phase) : ""}</p>
  ${artifacts}
  <p class="meta">${links}</p>
</section>`;
  };

  const indexBody = `<h1>Rome Romberger</h1>
<p class="lede">Cloud architecture and deployment engineering. I take systems that work in a demo and make them work in someone else's environment \u2014 which is usually a different problem.</p>
${featured.map(card).join("\n")}
${rest.length ? `<h2>Also</h2>\n${rest.map(card).join("\n")}` : ""}`;

  writeFileSync(join(SITE, "index.html"), page({
    title: "Rome Romberger",
    description: "Cloud architecture and deployment engineering.",
    body: indexBody,
    footer: FOOTER,
  }));

  // --- one page per case study ---------------------------------------------
  let studies = 0;
  for (const p of projects) {
    if (!p.case_study) continue;
    const md = readFileSync(join(REPO, p.case_study), "utf8");
    let html = wrapWide(liftMermaid(marked.parse(md)));
    const body = `<a class="backlink" href="../index.html">\u2190 All work</a>\n${html}`;
    const out = join(SITE, p.case_study.replace(/\.md$/, ".html"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, page({
      title: `${p.name} \u2014 case study`,
      description: p.tagline,
      body,
      footer: FOOTER,
      scripts: /```mermaid/.test(md) ? MERMAID_CDN : "",
    }));
    studies++;
  }

  // GitHub Pages must not run Jekyll over generated output.
  writeFileSync(join(SITE, ".nojekyll"), "");
  console.log(`portfolio: wrote site/ (index + ${studies} case study page(s))`);
}

if (process.argv.includes("--site")) {
  await buildSite();
} else if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(join(REPO, "README.md"), "utf8"); } catch { /* stale */ }
  if (current !== body) {
    console.error("portfolio: FAILED — README.md is stale. Run: node scripts/build.mjs");
    process.exit(1);
  }
  console.log(`portfolio: in sync (${projects.length} projects, all entries valid).`);
} else {
  writeFileSync(join(REPO, "README.md"), body);
  console.log(`portfolio: wrote README.md from ${projects.length} projects.`);
}
