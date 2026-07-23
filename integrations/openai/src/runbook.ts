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
      { id: "connected-context", title: "Verbundener Verein ohne erneute Kennung", account_role: "member", expected: "Bei „mein Verein“ wird cv_whoami_read ohne Eingabe genutzt; ChatGPT fragt weder Club-ID noch Domain erneut ab." },
      { id: "personal-reminder", title: "Persönliche Aufgaben-Erinnerung", account_role: "member", expected: "Aufgabe wird mit cv_my_tasks_read ermittelt und die Erinnerung ausschließlich für das OAuth-Subjekt ohne Empfänger-ID gesetzt." },
      { id: "grounded-empty-error", title: "Leere Ergebnisse und sichere Ablehnungen", account_role: "member", expected: "Leere Listen werden wahrheitsgemäß benannt; fehlender Scope oder Backend-403 führt zu einer handlungsfähigen Antwort ohne interne Kennungen." },
      { id: "club-agent-gate", title: "Club-Agent nur mit Freigabeartefakt", account_role: "manager", expected: "Komplexe Orchestrierung nutzt cv_club_agent_converse nur bei gültigem Capability-Release; sonst folgt eine handlungsfähige Ablehnung." },
    ],
  });
}
