import { CONFIRMATION_TTL_SECONDS, IDEMPOTENCY_TTL_SECONDS, PREVIEW_TTL_SECONDS } from "@comvenio/connector-contracts";

export const ANTHROPIC_ADAPTER_RUNTIME_CONTRACT = Object.freeze({
  additional_domain_round_trips: 0,
  tool_sync_in_end_user_request: false,
  claude_surface_timeout_seconds: 300,
  oauth_endpoint_max_latency_seconds: 10,
  preview_ttl_seconds: PREVIEW_TTL_SECONDS,
  confirmation_ttl_seconds: CONFIRMATION_TTL_SECONDS,
  idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
});
