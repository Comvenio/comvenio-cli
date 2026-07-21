import { createHash } from "node:crypto";
import type { JsonValue, UUID } from "../index.ts";

function canonicalNumber(value: number): string { if (!Number.isFinite(value)) throw new Error("Nicht-endliche Zahlen sind in Safety-Payloads nicht erlaubt."); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
export function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}
export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function safetyPayloadHash(input: { subject_id: UUID; club_id: UUID; tool_name: string; capability_version: string; normalized_input: JsonValue }): string { return sha256(canonicalJson(input)); }
export function assertSafeNormalizedInput(value: JsonValue): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const entry of value) assertSafeNormalizedInput(entry); return; }
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:confirmation|confirmation_token|token|authorization|idempotency_key)$/iu.test(key)) throw new Error("Safety-Steuerdaten dürfen nicht im normalisierten Fachinput enthalten sein.");
    assertSafeNormalizedInput(entry);
  }
}
