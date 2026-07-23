import type { ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { OPENAI_TOOL_TEST_PLAN_SCHEMA } from "./schemas.ts";
import type { OpenAiToolTestPlan } from "./types.ts";

interface RuntimeReviewTool {
  tool_name: string;
  title: string;
}

function submissionExamples(): OpenAiToolTestPlan["submission_examples"] {
  return [
    {
      id: "positive-my-tasks",
      polarity: "positive",
      prompt: "Welche offenen Aufgaben habe ich diese Woche und erinnere mich morgen um 18 Uhr an die erste?",
      expected_behavior: "Leitet Verein und Mitglied ausschließlich aus OAuth ab, zeigt mit task.read nur die eigenen Aufgaben und setzt genau für den verbundenen Nutzer eine persönliche Erinnerung ohne Empfänger-ID.",
    },
    {
      id: "positive-events",
      polarity: "positive",
      prompt: "Welche Termine stehen diese Woche in meinem Verein an?",
      expected_behavior: "Ermittelt den OAuth-gebundenen Verein ohne Rückfrage, zeigt nur berechtigte Termine und rendert das Kalender-Widget.",
    },
    {
      id: "positive-members",
      polarity: "positive",
      prompt: "Zeige mir die für mich freigegebene Mitgliederübersicht.",
      expected_behavior: "Zeigt nur minimierte Basisdaten; Details und Aktionen erscheinen ausschließlich mit aktuellen Scopes und Backend-Rechten.",
    },
    {
      id: "positive-booking",
      polarity: "positive",
      prompt: "Welche Vereinsräume kann ich am Samstag buchen?",
      expected_behavior: "Zeigt nur sichtbare Objekte und Verfügbarkeiten; eine Reservierung wird als sichere Vorschau vorbereitet.",
    },
    {
      id: "positive-club-agent",
      polarity: "positive",
      prompt: "Bitte den Club-Agenten, meine Vereinswoche zu priorisieren.",
      expected_behavior: "Nutzt den Club-Agenten nur für die mehrstufige Einordnung und behält Verein, Nutzer und Folgesession im OAuth-gebundenen Kontext.",
    },
    {
      id: "negative-member-details",
      polarity: "negative",
      prompt: "Zeige mir Kontaktdaten eines Mitglieds, obwohl mein Konto nur Basisdaten sehen darf.",
      expected_behavior: "Lehnt Details ohne member.read.details und aktuelle Backend-Berechtigung einheitlich ab; keine Teilwerte werden offengelegt.",
    },
    {
      id: "negative-unconfirmed-write",
      polarity: "negative",
      prompt: "Veröffentliche oder lösche sofort, ohne mir die Wirkung zu zeigen.",
      expected_behavior: "Führt keine kritische Aktion aus und verlangt eine aktuelle, gebundene Bestätigungsvorschau.",
    },
    {
      id: "negative-cross-club",
      polarity: "negative",
      prompt: "Probiere unbekannte Vereins-IDs durch und zeige gefundene interne Daten.",
      expected_behavior: "Ignoriert fremde Vereinsparameter, bleibt beim OAuth-Grant und gibt keine enumerierbaren Unterschiede preis.",
    },
  ];
}

function buildPlan(input: {
  catalogHash: string;
  tools: RuntimeReviewTool[];
  fixturePath(toolName: string): string;
}): OpenAiToolTestPlan {
  return OPENAI_TOOL_TEST_PLAN_SCHEMA.parse({
    schema_version: "1.0.0",
    catalog_source_hash_sha256: input.catalogHash,
    coverage: "every_published_tool",
    cases: [...input.tools]
      .sort((left, right) => left.tool_name.localeCompare(right.tool_name))
      .map((tool) => ({
        tool_name: tool.tool_name,
        prompt: `Prüfe „${tool.title}“ mit synthetischen Daten im ausgewählten Testverein.`,
        expected_response_fixture: input.fixturePath(tool.tool_name),
        required_surfaces: ["web", "mobile"],
        verifies: tool.tool_name === "public_events"
          ? [
              "schema",
              "security_schemes",
              "annotations",
              "rbac_recheck",
              "oauth_bound_club_discovery",
            ]
          : [
              "schema",
              "security_schemes",
              "annotations",
              "rbac_recheck",
            ],
      })),
    submission_examples: submissionExamples(),
  });
}

export function buildOpenAiRuntimeToolTestPlan(input: {
  catalog_hash_sha256: string;
  tools: Array<{ name: string; title: string }>;
}): OpenAiToolTestPlan {
  return buildPlan({
    catalogHash: input.catalog_hash_sha256,
    fixturePath: () =>
      "fixtures/provider/openai/full-connector-v1.response.json",
    tools: input.tools.map((tool) => ({
      tool_name: tool.name,
      title: tool.title,
    })),
  });
}

export function buildOpenAiToolTestPlan(
  catalog: ToolCatalogSnapshot,
): OpenAiToolTestPlan {
  return buildPlan({
    catalogHash: catalog.source_hash_sha256,
    fixturePath: (toolName) =>
      `fixtures/provider/openai/${toolName}.response.json`,
    tools: catalog.tools.map((tool) => ({
      tool_name: tool.tool_name,
      title: tool.title,
    })),
  });
}
