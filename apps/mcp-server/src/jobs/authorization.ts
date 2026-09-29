import type { CapabilitySnapshot } from "@comvenio/auth";
import {
  createConnectorError,
  normalizeRequestContext,
  type OAuthScope,
  type RequestContext,
  type UploadPurpose,
} from "@comvenio/connector-contracts";

import type { FileAuthorizationPort } from "../files/types.ts";
import type { JobExecutorRegistry } from "./executors.ts";
import type { JobAuthorizationPort } from "./types.ts";

export type CapabilitySnapshotSource = () => Promise<CapabilitySnapshot | null>;

function denied(context: RequestContext, message: string): Error {
  return createConnectorError({ code: "PERMISSION_DENIED", message, request_id: context.request_id, retryable: false });
}

/**
 * Checks that the capability snapshot belongs to the calling subject and club
 * and is still current; returns its capability_version.
 */
async function currentSnapshotVersion(
  source: CapabilitySnapshotSource,
  contextInput: RequestContext,
  now: () => Date,
): Promise<string> {
  const context = normalizeRequestContext(contextInput);
  const snapshot = await source();
  if (!snapshot
    || !context.subject_id
    || !context.club_id
    || snapshot.subject_id !== context.subject_id
    || snapshot.club_id !== context.club_id
    || Date.parse(snapshot.expires_at) <= now().getTime()) {
    throw denied(context, "Der aktuelle Berechtigungskontext fehlt oder ist abgelaufen.");
  }
  return String(snapshot.capability_version);
}

function requireScopes(context: RequestContext, anyOf: readonly OAuthScope[]): void {
  if (!anyOf.some((scope) => context.scopes.includes(scope))) {
    throw createConnectorError({
      code: "SCOPE_REQUIRED",
      message: `Für diese Dateiaktion fehlt der Scope ${anyOf[0]}.`,
      request_id: context.request_id,
      retryable: false,
      required_scope: anyOf[0]!,
    });
  }
}

const FILE_ACTION_SCOPES: Record<Parameters<FileAuthorizationPort["reauthorize"]>[0]["action"], readonly OAuthScope[]> = {
  upload_start: ["files.write"],
  upload_complete: ["files.write"],
  file_get: ["files.read", "files.import", "files.export"],
  file_consume: ["files.write"],
};

/**
 * Production FileAuthorizationPort: re-checks the file scopes of the action
 * against the request context and binds the result to the current
 * capability snapshot (request path: the snapshot resolved for this MCP
 * request; worker path: the snapshot resolved with the job actor).
 */
export class SnapshotFileAuthorization implements FileAuthorizationPort {
  constructor(
    private readonly snapshot: CapabilitySnapshotSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reauthorize(input: {
    context: RequestContext;
    action: "upload_start" | "upload_complete" | "file_get" | "file_consume";
    purpose?: UploadPurpose | "job_result";
  }): Promise<{ capability_version: string }> {
    requireScopes(input.context, FILE_ACTION_SCOPES[input.action]);
    return { capability_version: await currentSnapshotVersion(this.snapshot, input.context, this.now) };
  }
}

/**
 * Production JobAuthorizationPort: a start needs a registered executor behind
 * the tool and all its scopes; status and cancel read only the caller's own
 * jobs (ownership is enforced by AsyncJobService) under a current snapshot.
 */
export class SnapshotJobAuthorization implements JobAuthorizationPort {
  constructor(
    private readonly snapshot: CapabilitySnapshotSource,
    private readonly executorScopes: (toolName: string) => readonly OAuthScope[] | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reauthorize(input: {
    context: RequestContext;
    tool_name: string;
    action: "start" | "status" | "cancel";
  }): Promise<{ capability_version: string }> {
    const context = normalizeRequestContext(input.context);
    if (input.action === "start") {
      const scopes = this.executorScopes(input.tool_name);
      if (!scopes) throw denied(context, "Für diese Aktion ist kein Hintergrundauftrag freigegeben.");
      for (const scope of scopes) requireScopes(context, [scope]);
    }
    return { capability_version: await currentSnapshotVersion(this.snapshot, context, this.now) };
  }
}

export function executorScopesByToolName(
  registry: JobExecutorRegistry,
  toolName: (actionId: string) => string,
): (tool: string) => readonly OAuthScope[] | null {
  // Several operations of one action share a tool; the start requires the union of their scopes.
  const scopes = new Map<string, Set<OAuthScope>>();
  for (const executor of registry.list()) {
    const name = toolName(executor.action_id);
    const entry = scopes.get(name) ?? new Set<OAuthScope>();
    for (const scope of executor.required_scopes) entry.add(scope);
    scopes.set(name, entry);
  }
  return (tool) => {
    const entry = scopes.get(tool);
    return entry ? [...entry].sort() : null;
  };
}
