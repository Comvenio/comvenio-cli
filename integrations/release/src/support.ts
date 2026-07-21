import { SUPPORT_RUNBOOK_SCHEMA } from "./schemas.ts";
import type { SupportRunbook } from "./types.ts";

export function buildSupportRunbook(): SupportRunbook {
  return SUPPORT_RUNBOOK_SCHEMA.parse({
    schema_version: "1.0.0",
    entity: "SupportRunbook",
    document_path: "./support-runbook.md",
    support_email: "support@comvenio.de",
    user_log_access: false,
    revoke_paths: [
      "POST https://api.comvenio.app/auth/oauth/revoke",
      "DELETE https://api.comvenio.app/auth/oauth/grants/{grant_id}",
    ],
    rollback_order: ["disable_writes", "widgets_read_only", "pause_provider_listing", "revoke_grants_on_token_risk", "document_incident"],
    rollback_triggers: [
      "Critical oder High Security-/Datenschutzbefund",
      "Tenant-Isolation-Fehler",
      "OAuth-Widerruf ohne Wirkung",
      "umgehbare Bestätigung",
      "falsche öffentliche Datenfreigabe",
      "Fehlerquote über 5 Prozent für 15 Minuten",
      "p95-Latenz über 8 Sekunden für 30 Minuten bei Inline-Tools",
    ],
    user_help_topics: ["Comvenio mit ChatGPT oder Claude verbinden", "Verein auswählen und wechseln", "Eigene Rechte verstehen", "Verbindung widerrufen", "Sichere Vorschau und Bestätigung", "Datenschutz und Support"],
  });
}
