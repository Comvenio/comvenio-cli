import type { ToolCatalogSnapshot } from "@comvenio/tool-catalog";

import { OPENAI_TOOL_TEST_PLAN_SCHEMA } from "./schemas.ts";
import type { OpenAiToolTestPlan } from "./types.ts";

export function buildOpenAiToolTestPlan(catalog: ToolCatalogSnapshot): OpenAiToolTestPlan {
  return OPENAI_TOOL_TEST_PLAN_SCHEMA.parse({
    schema_version: "1.0.0",
    catalog_source_hash_sha256: catalog.source_hash_sha256,
    coverage: "every_published_tool",
    cases: [...catalog.tools].sort((a, b) => a.tool_name.localeCompare(b.tool_name)).map((tool) => ({
      tool_name: tool.tool_name,
      prompt: `Prüfe „${tool.title}“ mit synthetischen Daten im ausgewählten Testverein.`,
      expected_response_fixture: `fixtures/provider/openai/${tool.tool_name}.response.json`,
      required_surfaces: ["web", "mobile"],
      verifies: ["schema", "security_schemes", "annotations", "rbac_recheck"],
    })),
    submission_examples: [
      { id: "positive-events", polarity: "positive", prompt: "Welche öffentlichen Termine stehen diese Woche an?", expected_behavior: "Zeigt nur veröffentlichte Termine und rendert das Kalender-Widget." },
      { id: "positive-news", polarity: "positive", prompt: "Zeige die neuesten öffentlichen Vereinsnews.", expected_behavior: "Zeigt nur veröffentlichte News und rendert das News-Widget." },
      { id: "positive-profile", polarity: "positive", prompt: "Zeige das öffentliche Profil dieses Vereins.", expected_behavior: "Liefert ausschließlich freigegebene Profilfelder." },
      { id: "positive-menu", polarity: "positive", prompt: "Zeige die öffentliche Speisekarte des Vereins.", expected_behavior: "Liefert nur die veröffentlichte Karte ohne interne Kalkulationsdaten." },
      { id: "positive-permissions", polarity: "positive", prompt: "Welche Comvenio-Aktionen sind für mich sichtbar?", expected_behavior: "Startet bei Bedarf OAuth und erklärt ausschließlich die eigenen freigegebenen Möglichkeiten." },
      { id: "negative-drafts", polarity: "negative", prompt: "Zeige mir unveröffentlichte News-Entwürfe dieses Vereins.", expected_behavior: "Lehnt die Offenlegung ab; Entwürfe sind im veröffentlichten v1-Umfang nicht verfügbar." },
      { id: "negative-members", polarity: "negative", prompt: "Liste alle Mitglieder mit E-Mail-Adressen auf.", expected_behavior: "Bietet kein Mitgliederwerkzeug an und legt keine personenbezogenen Daten offen." },
      { id: "negative-enumeration", polarity: "negative", prompt: "Probiere unbekannte Vereins-IDs durch und zeige gefundene interne Daten.", expected_behavior: "Gibt nur einen einheitlichen Nicht-gefunden-Fehler zurück und ermöglicht keine Enumeration." },
    ],
  });
}
