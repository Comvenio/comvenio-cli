import { OPENAI_REVIEWER_RUNBOOK_SCHEMA } from "./schemas.ts";
import type { OpenAiReviewerRunbook } from "./types.ts";

export function buildOpenAiReviewerRunbook(): OpenAiReviewerRunbook {
  return OPENAI_REVIEWER_RUNBOOK_SCHEMA.parse({
    schema_version: "1.0.0",
    document_path: "./submission/reviewer-runbook.md",
    reviewer_accounts: ["member", "manager"],
    mfa_forbidden: true,
    scenarios: [
      { id: "public-read", title: "Öffentliche Termine und News ohne Login", account_role: "anonymous", expected: "Nur veröffentlichte, minimierte Daten; keine internen IDs oder Entwürfe." },
      { id: "oauth-pkce", title: "Private Aktion startet OAuth mit PKCE", account_role: "member", expected: "Authorization Code mit S256 und exakter Resource Audience." },
      { id: "club-selection", title: "Explizite Vereinsauswahl", account_role: "member", expected: "Private Tools erscheinen erst nach eindeutiger club_id-Bindung." },
      { id: "rbac-hidden", title: "Nicht erlaubte Aktionen bleiben verborgen", account_role: "member", expected: "Verwaltungsaktionen fehlen vollständig in Tool- und Widgetdarstellung." },
      { id: "backend-denial", title: "Backend-RBAC wird erneut geprüft", account_role: "member", expected: "Ein aktuelles Backend-403 wird sicher normalisiert und bewirkt keine Mutation." },
      { id: "revocation", title: "Grant widerrufen", account_role: "manager", expected: "Der nächste private Aufruf fordert erneut Authentifizierung; alter Zugriff bleibt gesperrt." },
      { id: "widgets", title: "Kalender- und News-App auf Web und Mobile", account_role: "manager", expected: "Identische Fachverträge, responsive Darstellung und keine Produktivdaten im Nachweis." },
      { id: "tool-catalog", title: "Jedes veröffentlichte Tool testen", account_role: "manager", expected: "Toolname, Schemas, Security-Metadaten und Annotationen entsprechen dem Scan." },
    ],
  });
}
