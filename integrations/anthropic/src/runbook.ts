import { CLAUDE_REVIEWER_RUNBOOK_SCHEMA } from "./schemas.ts";
import type { ClaudeReviewerRunbook } from "./types.ts";

const allSurfaces = ["web", "desktop", "mobile"] as const;

export function buildClaudeReviewerRunbook(): ClaudeReviewerRunbook {
  return CLAUDE_REVIEWER_RUNBOOK_SCHEMA.parse({
    schema_version: "1.0.0",
    document_path: "./submission/reviewer-runbook.md",
    reviewer_accounts: ["member", "manager"],
    mfa_forbidden: true,
    scenarios: [
      { id: "public-read", title: "Öffentliche Termine und News ohne Login", account_role: "anonymous", surfaces: allSurfaces, expected: "Nur veröffentlichte, minimierte Daten; keine internen IDs oder Entwürfe." },
      { id: "oauth-cimd", title: "Private Aktion startet OAuth-CIMD", account_role: "member", surfaces: allSurfaces, expected: "Öffentlicher Client, token endpoint auth none, PKCE S256 und exakte Resource Audience." },
      { id: "club-selection", title: "Explizite Vereinsauswahl", account_role: "member", surfaces: allSurfaces, expected: "Private Tools erscheinen erst nach eindeutiger club_id-Bindung." },
      { id: "rbac-hidden", title: "Nicht erlaubte Aktionen bleiben verborgen", account_role: "member", surfaces: allSurfaces, expected: "Verwaltungsaktionen fehlen vollständig in Tool- und Widgetdarstellung." },
      { id: "backend-denial", title: "Backend-RBAC wird erneut geprüft", account_role: "member", surfaces: allSurfaces, expected: "Ein aktuelles Backend-403 wird sicher normalisiert und bewirkt keine Mutation." },
      { id: "revocation", title: "Grant widerrufen", account_role: "manager", surfaces: allSurfaces, expected: "Der nächste private Aufruf fordert erneut Authentifizierung; alter Zugriff bleibt gesperrt." },
      { id: "widgets", title: "Kalender- und News-App", account_role: "manager", surfaces: allSurfaces, expected: "Gemeinsame Builds rendern responsiv und ohne Produktivdaten." },
      { id: "public-minimization", title: "Public Read bleibt minimiert", account_role: "anonymous", surfaces: allSurfaces, expected: "Nur veröffentlichte Allowlist-Felder; Entwürfe, interne IDs und personenbezogene Daten fehlen." },
      { id: "tool-sync", title: "Jedes Tool im Inspector und als Custom Connector", account_role: "manager", surfaces: allSurfaces, expected: "Happy Path und Permission-Denial stimmen mit Tooltitel, Schema und Annotationen überein." },
    ],
  });
}
