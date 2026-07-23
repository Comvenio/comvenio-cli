import { PRIVACY_THREAT_MODEL_SCHEMA } from "./schemas.ts";
import type { PrivacyThreatModel, SecurityPrivacyFinding } from "./types.ts";

function findingBlocks(findings: SecurityPrivacyFinding[]): boolean {
  return findings.some((finding) => finding.status === "open" && (["critical", "high"].includes(finding.severity)
    || (finding.severity === "medium" && (!finding.owner || !finding.mitigation))));
}

export function buildPrivacyThreatModel(findings: SecurityPrivacyFinding[] = []): PrivacyThreatModel {
  return PRIVACY_THREAT_MODEL_SCHEMA.parse({
    schema_version: "1.0.0",
    entity: "PrivacyThreatModel",
    country: "DE",
    privacy_priority: "highest",
    data_flows: [
      "Nutzerabsicht -> Provider -> Cloudflare Edge -> Comvenio Remote MCP -> autoritativer Fachservice",
      "Backend-RBAC -> minimiertes Toolresultat -> gemeinsames Widget -> Provideroberfläche",
      "OAuth-Grant -> exakt ein ausgewählter Verein -> kurz gecachter Capability-Snapshot",
      "Persönliche Aufgabe -> Task-Service-RBAC -> minimierte Aufgaben-Allowlist ohne Zuweisungs- oder Mitglieds-IDs",
      "Erinnerungsabsicht -> Task-Service-RBAC -> subject-gebundener Automation-Job -> Zustellungs-Recheck bei Task-/Member-Service -> Notify-Service -> ausschließlich OAuth-/JWT-Subjekt",
      "Kritischer Write -> serverinterne Vorschau -> zweite Bestätigung -> idempotenter Dispatch",
      "Provider-Review -> ausschließlich synthetische Konten, Fixtures und Screenshots",
    ],
    minimization_rules: [
      "Nicht erlaubte Tools und Aktionen werden verborgen.",
      "Persönliche Task-Tools werden ohne ihre OAuth-Scopes nicht registriert und erscheinen auch nicht in cv_schema_read.",
      "Mitgliederdetails werden erst nach explizitem, berechtigtem Abruf geladen.",
      "Public Read enthält nur veröffentlichte Allowlist-Felder ohne interne IDs.",
      "Bestätigungsansichten enthalten nur maskierte Wirkung und keine Rohpayloads.",
      "Dateien verlassen den MCP nur als kurzlebige, autorisierte Referenzen.",
      "Telemetrie enthält keine Toolargumente, Tokens, Vereins- oder Mitgliederdaten.",
      "Aufgabenergebnisse enthalten nur freigegebene Fachfelder; Zuweisungs-, Mitglieds-, Benutzer-, Audit- und System-IDs werden verworfen.",
      "Persönliche Aufgaben-Erinnerungen akzeptieren keine Benutzer- oder Empfänger-ID und adressieren ausschließlich das authentifizierte Subjekt.",
      "Unmittelbar vor Versand werden aktuelle Reminder-Generation, Aufgabenexistenz und aktive Mitgliedschaft erneut geprüft; gelöschte, ersetzte oder widerrufene Jobs werden fail-closed verworfen.",
      "Der private Notify-Topic akzeptiert exakt einen Zielnutzer und besitzt keinen Fallback auf Club-, Abteilungs- oder Rollenempfänger.",
      "Automation und Notify erhalten nur den für die Erinnerung erforderlichen Aufgabenbezug, Zeitpunkt, optionalen Nutzerkommentar und das serverseitig abgeleitete Ziel.",
      "Freie Reminder-Kommentare werden als Text behandelt; private Task-Payloads werden nicht in allgemeine Task-Streams, Inhaltslogs oder Dead-Letter-Payloads kopiert.",
      "Reduzierte Dead-Letter-Metadaten privater Task-Reminder werden nach höchstens sieben Tagen entfernt.",
      "Das Edge-Secret erscheint weder in Providerantworten noch in Telemetrie oder Releaseartefakten.",
      "Reviewartefakte enthalten keine personenbezogenen Produktivdaten.",
    ],
    retention_seconds: { capability_snapshot: 30, private_introspection_read: 5, preview: 300, confirmation: 300, idempotency: 86_400, upload_handle: 900, result_file: 86_400, job_metadata: 604_800 },
    telemetry_allowlist: ["request_id", "provider", "route", "method", "status_code", "outcome", "duration_ms", "authenticated", "recorded_at"],
    data_subject_rights: ["Verbindung und Grant jederzeit widerrufen", "Auskunft über die eigene Verbindung und effektive Rechte", "Persönliche Aufgaben-Erinnerung jederzeit über Web, CLI oder Connector löschen", "Löschung gemäß Comvenio-Löschkonzept", "Berichtigung in den autoritativen Fachservices", "Supportkontakt ohne Endnutzerzugriff auf den Log-Service"],
    log_service: { connected_to_mcp: false, end_user_access: false, audience: "master_admin_only" },
    review_fixtures: { production_data_allowed: false, synthetic_data_required: true },
    findings,
    status: findingBlocks(findings) ? "blocked" : "approved",
  });
}
