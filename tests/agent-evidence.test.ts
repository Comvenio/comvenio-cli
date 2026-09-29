import { expect, test } from "bun:test";
import cac from "cac";
import { registerAgentCommands } from "../src/commands/agent.ts";
import { EVIDENCE_CLUB_ID, evidenceApprovalId, readAgentEvidence } from "../src/util/agent-evidence.ts";
const id = "0b2c3d4e-1234-4abc-8def-0123456789ab";
const valid = () => ({
  schema_version: "club-agent-dev-observation.v1", club_id: EVIDENCE_CLUB_ID,
  flow_id: id, session_id: id, approval_request_id: id, execution_id: id, object_id: id,
  source_commit: "a".repeat(40), contract_revision: "b".repeat(64), environment: "DEV",
  approval_mode: "human_click", verification_status: "verified", observed_at: "2026-09-29T04:00:00Z",
  stages: ["ingress", "card", "human_approval", "execution", "readback"],
});

function client(value: unknown, calls: string[] = []) {
  return { get: async <T>(service: "ai", path: string): Promise<T> => {
    calls.push(`${service}:${path}`); return value as T;
  }};
}

test("evidence action is reachable and validates before any request", async () => {
  const cli = cac("comvenio"); registerAgentCommands(cli);
  cli.parse(["bun", "comvenio", "agent", "evidence", id, "--json"], { run: false });
  expect(cli.args).toEqual(["evidence", id]);
  for (const input of [[], ["../admin"], [id, id]]) expect(() => evidenceApprovalId(input)).toThrow();
  const calls: string[] = [];
  await expect(readAgentEvidence(client(valid(), calls), id, id)).rejects.toThrow("Testverein");
  expect(calls).toEqual([]);
});

test("one authenticated read, response is minimized", async () => {
  const calls: string[] = [];
  const result = await readAgentEvidence(client({ ...valid(), token: "secret", messages: ["private"] }, calls), EVIDENCE_CLUB_ID, id);
  expect(calls).toEqual([`ai:/club-agents/${EVIDENCE_CLUB_ID}/approvals/${id}/evidence`]);
  expect(result).toEqual(valid());
});

for (const [name, change] of Object.entries({
  foreign: { approval_request_id: "1b2c3d4e-1234-4abc-8def-0123456789ab" },
  unknown: { verification_status: "unknown" }, partial: { stages: ["execution"] },
  duplicates: { stages: ["ingress", "card", "human_approval", "execution", "execution"] },
  production: { environment: "PROD" }, source: { source_commit: "abc1234" },
  automated: { approval_mode: "rule" },
})) {
  test(`rejects ${name} observation`, async () => {
    await expect(readAgentEvidence(client({ ...valid(), ...change }), EVIDENCE_CLUB_ID, id)).rejects.toThrow("Prüfbeleg");
  });
}
