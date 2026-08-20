#!/usr/bin/env node
/**
 * Portfolio build.
 *
 * projects/*.json is the single source of truth. README.md is GENERATED from it and
 * diff-gated in CI, so the two can never disagree. This is the same pattern the
 * PermitGraph repo uses for its LinkML-generated artifacts, applied here.
 *
 *   node scripts/build.mjs           write README.md
 *   node scripts/build.mjs --check   fail if README.md is stale, or any entry is invalid
 *
 * Validation is hand-rolled against schema/project.schema.json rather than pulling in
 * ajv: the schema uses a small, fixed subset of JSON Schema, and a portfolio that needs
 * a node_modules directory to render its own README is a portfolio that stops rendering.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
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

if (process.argv.includes("--check")) {
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
