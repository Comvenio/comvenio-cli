import { z } from "zod";

export const EVIDENCE_CLUB_ID = "476bc619-ddb4-4693-bbe6-45936fa4f47e";
const uuid = z.string().uuid();
const stages = ["ingress", "card", "human_approval", "execution", "readback"];
const observation = z.object({
  schema_version: z.literal("club-agent-dev-observation.v1"),
  club_id: z.literal(EVIDENCE_CLUB_ID),
  flow_id: uuid, session_id: uuid, approval_request_id: uuid, execution_id: uuid, object_id: uuid,
  source_commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  contract_revision: z.string().regex(/^[0-9a-f]{64}$/u),
  environment: z.literal("DEV"), approval_mode: z.literal("human_click"),
  verification_status: z.literal("verified"), observed_at: z.string().datetime({ offset: true }),
  stages: z.array(z.string()).refine(value => value.length === stages.length && stages.every(stage => value.includes(stage))),
});

export function evidenceApprovalId(words: string[] | undefined): string {
  if (words?.length !== 1 || !uuid.safeParse(words[0]).success) {
    throw new Error("agent evidence braucht genau eine Freigabe-Kennung (UUID).");
  }
  return words[0]!;
}

/** Reads the existing authenticated service; never clicks, executes or exports payloads. */
export async function readAgentEvidence(
  client: { get<T>(service: "ai", path: string): Promise<T> }, clubId: string, approvalId: string,
) {
  evidenceApprovalId([approvalId]);
  if (clubId !== EVIDENCE_CLUB_ID) throw new Error("Dieser Prüfbeleg ist nur im festgelegten Testverein verfügbar.");
  const raw = await client.get<unknown>("ai", `/club-agents/${clubId}/approvals/${approvalId}/evidence`);
  const parsed = observation.safeParse(raw);
  if (!parsed.success || parsed.data.approval_request_id !== approvalId) {
    throw new Error("Kein vollständiger, zu dieser Freigabe gehörender Prüfbeleg verfügbar.");
  }
  return parsed.data;
}
