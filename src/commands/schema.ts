import type { CAC } from "cac";
// Embedded domain schemas. The generator-owned subset is created by
// `bun run gen:schema` (scripts/gen-schema.ts), which parses the REAL code
// sources at generation time:
//   homepage → ClubHome/widgets/index.ts (WIDGET_REGISTRY, 71 kinds) +
//              ai-service/app/prompts/homepage_system.py + club_home_section.py
//   menu     → MenuPreview.tsx (MenuDesignOptions) + supply-service core.py (UnitType)
//   event/task/booking/member → the respective service enum classes.
// Schemas with `generated: true` must not be hand-edited. Curated workflow
// schemas use `generated: false` and are maintained alongside their command and
// public documentation. `gen:schema:check` validates only the generator-owned
// subset. Embedding the JSON keeps `schema` offline and deterministic.
import homepage from "../schema/homepage.json" with { type: "json" };
import design from "../schema/design.json" with { type: "json" };
import menu from "../schema/menu.json" with { type: "json" };
import event from "../schema/event.json" with { type: "json" };
import member from "../schema/member.json" with { type: "json" };
import booking from "../schema/booking.json" with { type: "json" };
import task from "../schema/task.json" with { type: "json" };
import sponsor from "../schema/sponsor.json" with { type: "json" };
import meeting from "../schema/meeting.json" with { type: "json" };
import data from "../schema/data.json" with { type: "json" };
import team from "../schema/team.json" with { type: "json" };
import object from "../schema/object.json" with { type: "json" };
import ingredient from "../schema/ingredient.json" with { type: "json" };
import ingredientCategory from "../schema/ingredient-category.json" with { type: "json" };
import shopping from "../schema/shopping.json" with { type: "json" };
import role from "../schema/role.json" with { type: "json" };
import coverage from "../schema/coverage.json" with { type: "json" };

type CoverageDomain = {
  id: string;
  status: string;
  actions?: unknown;
  gaps?: unknown;
  intentional_exclusions?: unknown;
  source?: unknown;
  docs?: unknown;
};

const coverageDomains = (coverage as { domains?: CoverageDomain[] }).domains ?? [];
const fallbackSchemas = Object.fromEntries(
  coverageDomains.map((entry) => [
    entry.id,
    {
      domain: entry.id,
      schema_kind: "workflow-coverage",
      generated: true,
      verified_at: (coverage as { verified_at?: string }).verified_at,
      status: entry.status,
      actions: entry.actions ?? [],
      known_gaps: entry.gaps ?? [],
      intentional_exclusions: entry.intentional_exclusions ?? [],
      source: entry.source ?? [],
      docs: entry.docs ?? [],
      detail: "For payload examples and field contracts, read the referenced public docs.",
    },
  ]),
);

const SCHEMAS: Record<string, unknown> = {
  ...fallbackSchemas,
  homepage,
  design,
  menu,
  event,
  member,
  booking,
  task,
  sponsor,
  meeting,
  data,
  team,
  object,
  ingredient,
  "ingredient-category": ingredientCategory,
  shopping,
  role,
  coverage,
};

const DOMAIN_SUMMARY: Record<string, string> = {
  homepage: "Tab/Section/Widget-Struktur, 71 Widget-Kinds, config-Felder, Templates",
  design: "Flex-Template Design-Config (hero/sections/decor/type/density) fuer custom_template_config",
  menu: "MenuDesignOptions (design_config) + UnitType + MenuItem-Felder",
  event: "event_type, visibility_scope, organizer_type, status + Create-Felder",
  member: "MemberCreate-Felder + TeamMemberRole",
  booking: "reservation_status, object_type + PATCH-Pflichtfelder",
  task: "status, priority, context_type + Create/Assignment-Felder",
  sponsor: "Lokale Sponsoren, Sponsoring-Angebote, Assignments, Logos und Vertragsdateien",
  meeting: "Sitzungsserien, Protokolle, Agenda, Teilnehmer, Voting, Beschluesse und Eintraege",
  data: "Dateien, Ordner, Rechte, Papers, Area-Sharing und Export",
  team: "Teams, Team-Mitglieder und Ressourcenprioritaeten",
  object: "Objekte, Gebaeude, Raeume sowie Buchungs- und Task-Regeln",
  ingredient: "Club-Zutaten CRUD",
  "ingredient-category": "Zutatenkategorien, Baum und Zuweisungen",
  shopping: "Einkaufslisten, Positionen und Generierung aus Rezept/Menu",
  role: "Custom Roles, Berechtigungsmatrix, Zuweisungen und effektive Rechte",
  coverage: "Workflow-Abdeckung, bekannte Luecken und bewusste Ausschluesse aller CLI-Domaenen",
};

function allDomainSummaries(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(SCHEMAS).map((domain) => {
      const covered = coverageDomains.find((entry) => entry.id === domain);
      return [
        domain,
        DOMAIN_SUMMARY[domain]
          ?? (covered ? `Workflow-Status: ${covered.status}; Details in docs/coverage.md` : "Offline-Domaenenvertrag"),
      ];
    }),
  );
}

/**
 * `comvenio schema [domain]` — emit the embedded domain schema for the operating
 * agent. `--json` is the DEFAULT (machine-readable is the whole point); pass
 * --pretty for a human-readable domain list. Unknown domain → exit code != 0 +
 * the valid domains on stderr (Sub-File 10 TC-05). No API call, no token.
 */
export function registerSchemaCommand(cli: CAC): void {
  cli
    .command("schema [domain]", "Gueltige Felder/Enums/Widget-Typen einer Domaene (maschinenlesbar)")
    .option("--json", "JSON-Ausgabe (Default an fuer schema)")
    .option("--pretty", "Menschenlesbare Domaenen-Liste (statt JSON)")
    .action((domain: string | undefined, opts: { json?: boolean; pretty?: boolean }) => {
      if (!domain) {
        // No domain → list all domains + summary.
        if (!opts.pretty) {
          console.log(
            JSON.stringify(
              {
                domains: Object.keys(SCHEMAS),
                summary: allDomainSummaries(),
                usage: "comvenio schema <domain> --json",
              },
              null,
              2,
            ),
          );
          return;
        }
        const lines = ["Verfuegbare Schema-Domaenen:", ""];
        for (const d of Object.keys(SCHEMAS)) {
          lines.push(`  ${d.padEnd(20)} ${allDomainSummaries()[d] ?? ""}`);
        }
        lines.push("", "Nutzung: comvenio schema <domain> --json");
        console.log(lines.join("\n"));
        return;
      }

      const schema = SCHEMAS[domain];
      if (!schema) {
        // Unknown domain → non-zero exit + valid list on stderr (TC-05).
        throw new Error(
          `Unbekannte Domaene "${domain}". Gueltige Domaenen: ${Object.keys(SCHEMAS).join(", ")}.`,
        );
      }
      // Default (and with --json): emit raw JSON. --pretty without --json: also JSON
      // (schema is structured data — human form is just indented JSON).
      console.log(JSON.stringify(schema, null, 2));
    });
}

