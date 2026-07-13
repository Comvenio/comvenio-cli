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

type CoverageRegistry = {
  registry_version: string;
  cli_version: string;
  verified_at: string;
  coverage_model: Record<CoverageStatus, string>;
  scope_note: string;
  domains: DomainCoverage[];
};

const root = resolve(import.meta.dir, "..");
const sourcePath = resolve(root, "src/coverage/domains.json");
const schemaPath = resolve(root, "src/schema/coverage.json");
const docsPath = resolve(root, "docs/coverage.md");

const registry = (await Bun.file(sourcePath).json()) as CoverageRegistry;
const validStatuses = new Set<CoverageStatus>([
  "covered",
  "core-partial",
  "intentional-exclusion",
]);

if (registry.domains.length !== 22) {
  throw new Error(`Coverage-Registry muss 22 Top-Level-Commands enthalten, gefunden: ${registry.domains.length}.`);
}

const ids = new Set<string>();
for (const domain of registry.domains) {
  if (ids.has(domain.id)) throw new Error(`Doppelte Coverage-Domaene: ${domain.id}.`);
  ids.add(domain.id);
  if (!validStatuses.has(domain.status)) {
    throw new Error(`Ungueltiger Coverage-Status fuer ${domain.id}: ${domain.status}.`);
  }
  if (domain.actions.length === 0) {
    throw new Error(`Coverage-Domaene ${domain.id} braucht mindestens eine Action.`);
  }
}

const summaryRows = registry.domains.map((domain) => {
  const pending = domain.integration_state === "pending" ? " (Integration ausstehend)" : "";
  const gap = domain.gaps.length ? domain.gaps.join(" ") : "Keine bekannte Kernluecke.";
  return `| \`${domain.id}\` | \`${domain.status}\`${pending} | ${domain.actions.join("<br>")} | ${gap} |`;
});

const details = registry.domains.map((domain) => {
  const removed = domain.removed_actions?.length
    ? `\n- Entfernte/gesperrte Actions: ${domain.removed_actions.map((action) => `\`${action}\``).join(", ")}`
    : "";
  const gaps = domain.gaps.length
    ? domain.gaps.map((gap) => `  - ${gap}`).join("\n")
    : "  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.";
  const exclusions = domain.intentional_exclusions.length
    ? domain.intentional_exclusions.map((item) => `  - ${item}`).join("\n")
    : "  - Keine.";
  return `## ${domain.id}\n\n- Status: \`${domain.status}\`${domain.integration_state === "pending" ? " (Integration ausstehend)" : ""}\n- Actions: ${domain.actions.map((action) => `\`${action}\``).join(", ")}${removed}\n- Wichtige Luecken:\n${gaps}\n- Bewusste Ausschluesse:\n${exclusions}\n- Gepruefte Quellen: ${domain.source.map((path) => `\`${path}\``).join(", ")}\n- Weiterfuehrende Doku: ${domain.docs.map((path) => `\`${path}\``).join(", ")}`;
});

const markdown = `# CLI-Coverage\n\n` +
  `Version \`${registry.registry_version}\` fuer comvenio-cli \`${registry.cli_version}\`, verifiziert am ${registry.verified_at}.\n\n` +
  `Diese Datei ist eine eigenstaendige, offline lesbare Workflow-Coverage. Sie wird aus \`src/coverage/domains.json\` erzeugt; die maschinenlesbare Kopie liegt unter \`src/schema/coverage.json\`.\n\n` +
  `> ${registry.scope_note}\n\n` +
  `## Statusmodell\n\n` +
  `- \`covered\`: ${registry.coverage_model.covered}\n` +
  `- \`core-partial\`: ${registry.coverage_model["core-partial"]}\n` +
  `- \`intentional-exclusion\`: ${registry.coverage_model["intentional-exclusion"]}\n\n` +
  `## Uebersicht\n\n` +
  `| Top-Level-Command | Status | Vorhandene Actions | Wichtige belegte Luecke |\n` +
  `|---|---|---|---|\n` +
  `${summaryRows.join("\n")}\n\n` +
  `## Verbindliche Nutzungsregeln\n\n` +
  `1. Nutze ausschliesslich dokumentierte CLI-Actions; direkte Backend-Aufrufe sind kein Ersatz fuer eine CLI-Luecke.\n` +
  `2. Lies fuer Payloads zuerst die verlinkte Domaenen-Doku und danach \`comvenio <domain> --help\`.\n` +
  `3. Nutze bei Agenten immer \`--json\`; Fehler erscheinen auf stderr und haben einen Exit-Code ungleich null.\n` +
  `4. \`core-partial\` bedeutet: den vorhandenen Teil nutzen, die dokumentierte Luecke aber nicht durch einen direkten API-Call umgehen.\n\n` +
  `${details.join("\n\n")}\n`;

await Bun.write(schemaPath, `${JSON.stringify(registry, null, 2)}\n`);
await Bun.write(docsPath, markdown);

console.log(`Coverage erzeugt: ${schemaPath}, ${docsPath}`);
