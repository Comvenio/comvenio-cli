import {
  CONFIRMATION_TTL_SECONDS,
  IDEMPOTENCY_TTL_SECONDS,
  PREVIEW_TTL_SECONDS,
} from "@comvenio/connector-contracts";

/** Provider adapter invariants inherited from the shared MCP safety contract. */
export const OPENAI_ADAPTER_RUNTIME_CONTRACT = Object.freeze({
  additional_domain_round_trips: 0,
  preview_ttl_seconds: PREVIEW_TTL_SECONDS,
  confirmation_ttl_seconds: CONFIRMATION_TTL_SECONDS,
  idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
});
