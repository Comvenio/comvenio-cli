import { resolve } from "node:path";

type CoverageStatus = "covered" | "core-partial" | "intentional-exclusion";

type DomainCoverage = {
  id: string;
  status: CoverageStatus;
  integration_state?: "pending";
  actions: string[];
  removed_actions?: string[];
  gaps: string[];
  intentional_exclusions: string[];
  source: string[];
  docs: string[];
};

/**
 * A backend area that has NO top-level command at all.
 *
 * Without these entries the registry only ever describes what was built, so a
 * reading agent mistakes "26 documented commands" for "the platform is fully
 * covered". Naming the blank spots — including the ones we deliberately do not
 * want — is the whole point.
 */
type UncoveredVerdict = "gap" | "partial-gap" | "no-gap" | "backend-missing";

type UncoveredDomain = {
  id: string;
  service: string;
  verdict: UncoveredVerdict;
  summary: string;
  missing_workflows: string[];
  proposed_actions: string[];
  rationale: string;
};

type CoverageRegistry = {
  registry_version: string;
  cli_version: string;
  verified_at: string;
  coverage_model: Record<CoverageStatus, string>;
  uncovered_model: Record<UncoveredVerdict, string>;
  scope_note: string;
  domains: DomainCoverage[];
  uncovered_domains: UncoveredDomain[];
};

const root = resolve(import.meta.dir, "..");
const sourcePath = resolve(root, "src/coverage/domains.json");
const schemaPath = resolve(root, "src/schema/coverage.json");
const docsPath = resolve(root, "docs/coverage.md");
const checkMode = process.argv.includes("--check");

const registry = (await Bun.file(sourcePath).json()) as CoverageRegistry;
const validStatuses = new Set<CoverageStatus>([
  "covered",
  "core-partial",
  "intentional-exclusion",
]);

if (registry.domains.length !== 27) {
  throw new Error(`Coverage-Registry muss 27 Top-Level-Commands enthalten, gefunden: ${registry.domains.length}.`);
}

const ids = new Set<string>();
for (const domain of registry.domains) {
  if (ids.has(domain.id)) throw new Error(`Doppelte Coverage-Domäne: ${domain.id}.`);
  ids.add(domain.id);
  if (!validStatuses.has(domain.status)) {
    throw new Error(`Ungültiger Coverage-Status für ${domain.id}: ${domain.status}.`);
  }
  if (domain.actions.length === 0) {
    throw new Error(`Coverage-Domäne ${domain.id} braucht mindestens eine Action.`);
  }
}

const validVerdicts = new Set<UncoveredVerdict>([
  "gap",
  "partial-gap",
  "no-gap",
  "backend-missing",
]);
const uncovered = registry.uncovered_domains ?? [];
const uncoveredIds = new Set<string>();
for (const area of uncovered) {
  if (uncoveredIds.has(area.id)) throw new Error(`Doppeltes unerschlossenes Gebiet: ${area.id}.`);
  uncoveredIds.add(area.id);
  if (ids.has(area.id)) {
    throw new Error(`${area.id} ist bereits ein Top-Level-Command und kann nicht unerschlossen sein.`);
  }
  if (!validVerdicts.has(area.verdict)) {
    throw new Error(`Ungültiges Verdikt für ${area.id}: ${area.verdict}.`);
  }
  // A real gap has to name what is missing, otherwise it is an unfalsifiable claim.
  if (area.verdict === "gap" && area.missing_workflows.length === 0) {
    throw new Error(`Unerschlossenes Gebiet ${area.id} ist als Lücke geführt, benennt aber keinen fehlenden Workflow.`);
  }
  if (!area.rationale) {
    throw new Error(`Unerschlossenes Gebiet ${area.id} braucht eine Begründung.`);
  }
}

const summaryRows = registry.domains.map((domain) => {
  const pending = domain.integration_state === "pending" ? " (Integration ausstehend)" : "";
  const gap = domain.gaps.length ? domain.gaps.join(" ") : "Keine bekannte Kernlücke.";
  return `| \`${domain.id}\` | \`${domain.status}\`${pending} | ${domain.actions.join("<br>")} | ${gap} |`;
});

const details = registry.domains.map((domain) => {
  const removed = domain.removed_actions?.length
    ? `\n- Entfernte/gesperrte Actions: ${domain.removed_actions.map((action) => `\`${action}\``).join(", ")}`
    : "";
  const gaps = domain.gaps.length
    ? domain.gaps.map((gap) => `  - ${gap}`).join("\n")
    : "  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.";
  const exclusions = domain.intentional_exclusions.length
    ? domain.intentional_exclusions.map((item) => `  - ${item}`).join("\n")
    : "  - Keine.";
  return `## ${domain.id}\n\n- Status: \`${domain.status}\`${domain.integration_state === "pending" ? " (Integration ausstehend)" : ""}\n- Actions: ${domain.actions.map((action) => `\`${action}\``).join(", ")}${removed}\n- Wichtige Lücken:\n${gaps}\n- Bewusste Ausschlüsse:\n${exclusions}\n- Geprüfte Quellen: ${domain.source.map((path) => `\`${path}\``).join(", ")}\n- Weiterführende Doku: ${domain.docs.map((path) => `\`${path}\``).join(", ")}`;
});

const uncoveredRows = uncovered.map((area) => {
  const workflows = area.missing_workflows.length ? area.missing_workflows.join("<br>") : "—";
  return `| \`${area.id}\` | ${area.service} | \`${area.verdict}\` | ${workflows} |`;
});

const uncoveredDetails = uncovered.map((area) => {
  const workflows = area.missing_workflows.length
    ? area.missing_workflows.map((item) => `  - ${item}`).join("\n")
    : "  - Keine — dieses Gebiet braucht bewusst keinen CLI-Command.";
  const proposed = area.proposed_actions.length
    ? `\n- Vorgeschlagene Actions: ${area.proposed_actions.map((action) => `\`${action}\``).join(", ")}`
    : "";
  return `### ${area.id} (${area.service})\n\n- Verdikt: \`${area.verdict}\`\n- ${area.summary}\n- Fehlende Club-Admin-Workflows:\n${workflows}${proposed}\n- Begründung: ${area.rationale}`;
});

const uncoveredSection = uncovered.length
  ? `## Nicht erschlossene Themengebiete\n\n` +
    `> Backend-Bereiche **ohne** eigenen Top-Level-Command. Diese Liste ist der ehrliche Gegenpol zur Übersicht oben: ` +
    `Ohne sie liest sich "26 dokumentierte Commands" wie "die Plattform ist vollständig abgedeckt". ` +
    `Ein \`gap\` ist kein Freibrief für einen direkten API-Call — er wird geschlossen, indem das CLI erweitert wird.\n\n` +
    `- \`gap\`: ${registry.uncovered_model.gap}\n` +
    `- \`partial-gap\`: ${registry.uncovered_model["partial-gap"]}\n` +
    `- \`no-gap\`: ${registry.uncovered_model["no-gap"]}\n` +
    `- \`backend-missing\`: ${registry.uncovered_model["backend-missing"]}\n\n` +
    `| Gebiet | Service | Verdikt | Fehlende Club-Admin-Workflows |\n` +
    `|---|---|---|---|\n` +
    `${uncoveredRows.join("\n")}\n\n` +
    `${uncoveredDetails.join("\n\n")}\n\n`
  : "";

const markdown = `# CLI-Coverage\n\n` +
  `Version \`${registry.registry_version}\` für comvenio-cli \`${registry.cli_version}\`, verifiziert am ${registry.verified_at}.\n\n` +
  `Diese Datei ist eine eigenständige, offline lesbare Workflow-Coverage. Sie wird aus \`src/coverage/domains.json\` erzeugt; die maschinenlesbare Kopie liegt unter \`src/schema/coverage.json\`.\n\n` +
  `> ${registry.scope_note}\n\n` +
  `## Statusmodell\n\n` +
  `- \`covered\`: ${registry.coverage_model.covered}\n` +
  `- \`core-partial\`: ${registry.coverage_model["core-partial"]}\n` +
  `- \`intentional-exclusion\`: ${registry.coverage_model["intentional-exclusion"]}\n\n` +
  `## Übersicht\n\n` +
  `| Top-Level-Command | Status | Vorhandene Actions | Wichtige belegte Lücke |\n` +
  `|---|---|---|---|\n` +
  `${summaryRows.join("\n")}\n\n` +
  `## Verbindliche Nutzungsregeln\n\n` +
  `1. Nutze ausschließlich dokumentierte CLI-Actions; direkte Backend-Aufrufe sind kein Ersatz für eine CLI-Lücke.\n` +
  `2. Lies für Payloads zuerst die verlinkte Domänen-Doku und danach \`comvenio <domain> --help\`.\n` +
  `3. Nutze bei Agenten immer \`--json\`; Fehler erscheinen auf stderr und haben einen Exit-Code ungleich null.\n` +
  `4. \`core-partial\` bedeutet: den vorhandenen Teil nutzen, die dokumentierte Lücke aber nicht durch einen direkten API-Call umgehen.\n` +
  `5. Ein Gebiet aus "Nicht erschlossene Themengebiete" hat **keinen** Command. Auch dort gilt: kein direkter API-Call — das CLI wird erweitert.\n\n` +
  `${uncoveredSection}` +
  `${details.join("\n\n")}\n`;

const schemaOutput = `${JSON.stringify(registry, null, 2)}\n`;

if (checkMode) {
  const normalize = (value: string) => value.replace(/\r\n/g, "\n");
  const currentSchema = await Bun.file(schemaPath).text();
  const currentDocs = await Bun.file(docsPath).text();
  const drift: string[] = [];
  if (normalize(currentSchema) !== normalize(schemaOutput)) drift.push("src/schema/coverage.json");
  if (normalize(currentDocs) !== normalize(markdown)) drift.push("docs/coverage.md");
  if (drift.length) {
    throw new Error(`Coverage-Drift: ${drift.join(", ")}. Fuehre bun run gen:coverage aus.`);
  }
  console.log("Coverage-Registry, Offline-Schema und Doku sind synchron.");
} else {
  await Bun.write(schemaPath, schemaOutput);
  await Bun.write(docsPath, markdown);
  console.log(`Coverage erzeugt: ${schemaPath}, ${docsPath}`);
}
