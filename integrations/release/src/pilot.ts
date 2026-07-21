import { PILOT_PROTOCOL_SCHEMA } from "./schemas.ts";
import type { PilotProtocol, PilotScenarioId, SecurityPrivacyFinding } from "./types.ts";

export const REQUIRED_PILOT_SCENARIOS: readonly PilotScenarioId[] = [
  "public-events-news-menu-sponsors",
  "oauth-revocation-club-switch",
  "five-widgets-mobile-desktop",
  "member-manager-views",
  "reversible-write",
  "confirm-publication",
  "confirm-deletion",
  "confirm-import-export",
  "idempotent-retry",
  "cross-tenant-denial",
  "permission-denial",
];

function calendarDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

export function buildPilotProtocol(input: {
  club_reference?: string | null;
  pilot_owner?: string | null;
  started_on?: string | null;
  ended_on?: string | null;
  total?: number;
  successful?: number;
  scenario_counts?: Partial<Record<PilotScenarioId, number>>;
  data_leaks?: number;
  confirmation_bypasses?: number;
  findings?: SecurityPrivacyFinding[];
  evidence_refs?: string[];
} = {}): PilotProtocol {
  const total = input.total ?? 0;
  const successful = input.successful ?? 0;
  const scenarioCounts = input.scenario_counts ?? {};
  const findings = input.findings ?? [];
  const blockers: string[] = [];
  const completeIdentity = Boolean(input.club_reference && input.pilot_owner && input.started_on && input.ended_on);
  if (!completeIdentity) blockers.push("PILOT_IDENTITY_OR_DATES_PENDING");
  if (!input.started_on || !input.ended_on || calendarDays(input.started_on, input.ended_on) < 7) blockers.push("PILOT_MINIMUM_DAYS");
  if (successful < 30 || total < successful || total === 0 || successful / total < 0.95) blockers.push("PILOT_INTERACTION_THRESHOLD");
  if (REQUIRED_PILOT_SCENARIOS.some((scenario) => (scenarioCounts[scenario] ?? 0) < 1)) blockers.push("PILOT_SCENARIO_COVERAGE");
  if ((input.data_leaks ?? 0) !== 0) blockers.push("PILOT_DATA_LEAK");
  if ((input.confirmation_bypasses ?? 0) !== 0) blockers.push("PILOT_CONFIRMATION_BYPASS");
  if (findings.some((finding) => finding.status === "open" && ["critical", "high"].includes(finding.severity))) blockers.push("PILOT_CRITICAL_HIGH_FINDING");
  if (findings.some((finding) => finding.status === "open" && finding.severity === "medium" && (!finding.owner || !finding.mitigation))) blockers.push("PILOT_MEDIUM_WITHOUT_MITIGATION");
  const pending = !completeIdentity || total === 0 || (input.evidence_refs ?? []).length === 0;
  return PILOT_PROTOCOL_SCHEMA.parse({
    schema_version: "1.0.0",
    entity: "PilotProtocol",
    country: "DE",
    club_reference: input.club_reference ?? null,
    pilot_owner: input.pilot_owner ?? null,
    started_on: input.started_on ?? null,
    ended_on: input.ended_on ?? null,
    minimum_calendar_days: 7,
    minimum_successful_interactions: 30,
    minimum_success_rate: 0.95,
    interactions: { total, successful, scenario_counts: scenarioCounts, data_leaks: input.data_leaks ?? 0, confirmation_bypasses: input.confirmation_bypasses ?? 0 },
    findings,
    evidence_refs: input.evidence_refs ?? [],
    status: blockers.length === 0 ? "passed" : pending ? "pending" : "failed",
    blockers,
  });
}
