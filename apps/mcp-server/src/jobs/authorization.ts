import { ToolVisibilityPolicy, type CapabilitySnapshot } from "@comvenio/auth";
import {
  createConnectorError,
  normalizeRequestContext,
  type OAuthScope,
  type RequestContext,
  type UploadPurpose,
} from "@comvenio/connector-contracts";

import type { FileAuthorizationPort } from "../files/types.ts";
import { k12FilePermissionPolicy } from "../tools/content-homepage-news-data/definitions.ts";
import type { JobExecutorRegistry } from "./executors.ts";
import type { JobAuthorizationPort } from "./types.ts";

export type CapabilitySnapshotSource = () => Promise<CapabilitySnapshot | null>;

function denied(context: RequestContext, message: string): Error {
  return createConnectorError({ code: "PERMISSION_DENIED", message, request_id: context.request_id, retryable: false });
}

/**
 * Checks that the capability snapshot belongs to the calling subject and club
 * and is still current; returns it.
 */
async function currentSnapshot(
  source: CapabilitySnapshotSource,
  contextInput: RequestContext,
  now: () => Date,
): Promise<CapabilitySnapshot> {
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
  return snapshot;
}

async function currentSnapshotVersion(
  source: CapabilitySnapshotSource,
  contextInput: RequestContext,
  now: () => Date,
): Promise<string> {
  return String((await currentSnapshot(source, contextInput, now)).capability_version);
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

type FileAction = Parameters<FileAuthorizationPort["reauthorize"]>[0]["action"];

const FILE_ACTION_SCOPES: Record<FileAction, readonly OAuthScope[]> = {
  upload_start: ["files.write"],
  upload_complete: ["files.write"],
  file_get: ["files.read", "files.import", "files.export"],
  file_consume: ["files.write"],
};

/**
 * Club rights per file action, taken from the file profiles of the data
 * actions (file_write for everything that stores or consumes, file_read for
 * the reference). The profiles do not distinguish upload purposes, so every
 * purpose (including job results) needs the same rights.
 */
const FILE_ACTION_PROFILES: Record<FileAction, "file_read" | "file_write"> = {
  upload_start: "file_write",
  upload_complete: "file_write",
  file_get: "file_read",
  file_consume: "file_write",
};

/**
 * Evaluates the club rights of the action with the same policy evaluation as
 * the tool visibility. Identity, club and expiry of the snapshot were checked
 * before; the stored context of a job may carry an older capability_version,
 * so the evaluation is bound to the snapshot's own version and decides only
 * on the effective permissions and the department.
 */
function requireFilePermission(
  context: RequestContext,
  snapshot: CapabilitySnapshot,
  action: FileAction,
  now: () => Date,
): void {
  const decision = new ToolVisibilityPolicy(now).evaluate({
    tool: {
      tool_name: `connector_file:${action}`,
      required_scopes: [],
      permission_policy: k12FilePermissionPolicy(FILE_ACTION_PROFILES[action]),
      is_public: false,
    },
    context: { ...context, capability_version: String(snapshot.capability_version) },
    snapshot,
    provider_tool_updates: "dynamic",
    catalog_contains_tool: true,
  });
  if (!decision.authorized) {
    throw denied(context, "Für diese Dateiaktion fehlen im Verein die erforderlichen Rechte.");
  }
}

/**
 * Production FileAuthorizationPort: re-checks the file scopes of the action
 * against the request context, then the club rights of the action against
 * the current capability snapshot, and binds the result to that snapshot
 * (request path: the snapshot resolved for this MCP request; worker path: a
 * snapshot freshly resolved with the current job actor).
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
    const context = normalizeRequestContext(input.context);
    requireScopes(context, FILE_ACTION_SCOPES[input.action]);
    const snapshot = await currentSnapshot(this.snapshot, context, this.now);
    requireFilePermission(context, snapshot, input.action, this.now);
    return { capability_version: String(snapshot.capability_version) };
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
