import {
  ASYNC_JOB_HANDLE_SCHEMA,
  CONNECTOR_FILE_REFERENCE_SCHEMA,
  FILE_GET_INPUT_SCHEMA,
  FILE_UPLOAD_COMPLETE_INPUT_SCHEMA,
  JOB_STATUS_INPUT_SCHEMA,
  UPLOAD_CREATE_REQUEST_SCHEMA,
  UPLOAD_HANDLE_SCHEMA,
  createProviderNeutralResult,
  isConnectorError,
  type JsonValue,
  type OAuthScope,
  type RequestContext,
} from "@comvenio/connector-contracts";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainToolSummary } from "./domain-runtime.ts";
import { FileGetTool, FileUploadCompleteTool, FileUploadStartTool } from "./files/tools.ts";
import { HELP_TOOL_HINT } from "./help-tool.ts";
import type { JobFileRequestBinding } from "./jobs/platform.ts";
import { JobCancelTool, JobStatusTool } from "./jobs/tools.ts";
import { insufficientScopeToolResult } from "./oauth-tool-challenge.ts";
import type { ProtectedToolDescriptor } from "./public/types.ts";
import { publicToolError } from "./public-tool-error.ts";
import type { ToolSecurityScheme } from "./tool-security-schemes.ts";

/**
 * Platform tools of K15 (Anhang G.1/G.3): job status/cancel and the three
 * file tools. They are registered only while the uploads-and-jobs group is
 * configured. The club always comes from the OAuth grant; a passed club_id
 * must match it.
 */
const JOB_FILE_TOOLS = Object.freeze({
  cv_job_status_read: {
    scopes: ["club.read"] as OAuthScope[],
    risk_class: "read" as const,
    title: "Comvenio: Status eines Hintergrundauftrags",
    description: "Liest den Status eines eigenen Hintergrundauftrags im verbundenen Verein. Frage bei „queued“ oder „running“ mit Pausen von 1, 2, 4, 8, danach 15 Sekunden erneut.",
  },
  cv_job_cancel_write: {
    scopes: ["club.read"] as OAuthScope[],
    risk_class: "reversible_write" as const,
    title: "Comvenio: Hintergrundauftrag abbrechen",
    description: "Bricht einen eigenen, noch abbrechbaren Hintergrundauftrag im verbundenen Verein ab.",
  },
  cv_file_upload_start_write: {
    scopes: ["files.write"] as OAuthScope[],
    risk_class: "reversible_write" as const,
    title: "Comvenio: Datei-Upload starten",
    description: "Startet einen Upload in die geschützte Quarantäne und liefert eine einmalige HTTPS-Upload-Adresse. Danach die Bytes per PUT mit dem genannten Content-Type übertragen und cv_file_upload_complete_write aufrufen. Keine Dateiinhalte als Text oder Base64 übergeben.",
  },
  cv_file_upload_complete_write: {
    scopes: ["files.write"] as OAuthScope[],
    risk_class: "reversible_write" as const,
    title: "Comvenio: Datei-Upload abschließen",
    description: "Prüft Größe, SHA-256, Dateityp und Schadsoftware des hochgeladenen Objekts. Nur eine Datei im Zustand „clean“ kann danach genau einmal an eine Comvenio-Aktion übergeben werden.",
  },
  cv_file_get_read: {
    scopes: ["files.export"] as OAuthScope[],
    risk_class: "read" as const,
    title: "Comvenio: Eigene Datei abrufen",
    description: "Liefert eine kurzlebige HTTPS-Download-Referenz für eine eigene Datei im verbundenen Verein.",
  },
});

type JobFileToolName = keyof typeof JOB_FILE_TOOLS;

export const JOB_FILE_PROTECTED_TOOLS: readonly ProtectedToolDescriptor[] = Object.freeze(
  (Object.keys(JOB_FILE_TOOLS) as JobFileToolName[]).map((name) => ({
    tool_name: name,
    required_scopes: [...JOB_FILE_TOOLS[name].scopes],
  })),
);

const optionalClub = { club_id: z.string().uuid().optional() };
const jobInputSchema = JOB_STATUS_INPUT_SCHEMA.extend(optionalClub);
const uploadStartInputSchema = UPLOAD_CREATE_REQUEST_SCHEMA.extend(optionalClub);
const uploadCompleteInputSchema = FILE_UPLOAD_COMPLETE_INPUT_SCHEMA.extend(optionalClub);
const fileGetInputSchema = FILE_GET_INPUT_SCHEMA.extend(optionalClub);

function result(context: RequestContext, output: Record<string, JsonValue>, text: string): CallToolResult {
  return { ...createProviderNeutralResult(context, output, [{ type: "text", text }]), structuredContent: output };
}

export function registerJobFileTools(input: {
  server: McpServer;
  context: RequestContext;
  public_origin: string;
  binding: JobFileRequestBinding;
  advertised_security_schemes: Map<string, readonly ToolSecurityScheme[]>;
}): DomainToolSummary[] {
  const context = input.context;
  const clubId = context.club_id;
  if (!clubId) return [];
  const jobStatus = new JobStatusTool(input.binding.jobs);
  const jobCancel = new JobCancelTool(input.binding.jobs);
  const uploadStart = new FileUploadStartTool(input.binding.files);
  const uploadComplete = new FileUploadCompleteTool(input.binding.files);
  const fileGet = new FileGetTool(input.binding.files);

  function register<S extends z.ZodType>(
    name: JobFileToolName,
    inputSchema: S,
    outputSchema: z.ZodType,
    run: (parsed: z.infer<S>) => Promise<Record<string, JsonValue>>,
    text: (output: Record<string, JsonValue>) => string,
  ): void {
    const tool = JOB_FILE_TOOLS[name];
    const securitySchemes: ToolSecurityScheme[] = [{ type: "oauth2", scopes: [...tool.scopes] }];
    input.advertised_security_schemes.set(name, securitySchemes);
    registerAppTool(input.server, name, {
      title: tool.title,
      description: `${tool.description} ${HELP_TOOL_HINT}`,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: tool.risk_class === "read",
        destructiveHint: false,
        idempotentHint: name !== "cv_file_upload_start_write",
        openWorldHint: false,
      },
      _meta: { securitySchemes: structuredClone(securitySchemes) },
    }, async (arguments_) => {
      try {
        const parsed = inputSchema.parse(arguments_);
        const output = await run(parsed);
        return result(context, output, text(output));
      } catch (error) {
        if (isConnectorError(error) && error.code === "SCOPE_REQUIRED") {
          return insufficientScopeToolResult({
            public_origin: input.public_origin,
            required_scopes: [error.required_scope ?? tool.scopes[0]!],
            context,
          });
        }
        return publicToolError(context, input.public_origin, error, tool.risk_class === "read" ? "read" : "write");
      }
    });
  }

  register("cv_job_status_read", jobInputSchema, ASYNC_JOB_HANDLE_SCHEMA, async (parsed) =>
    await jobStatus.execute({ context, club_id: parsed.club_id ?? clubId, job_id: parsed.job_id }) as unknown as Record<string, JsonValue>,
  (output) => `Der Auftrag ist im Zustand ${String(output.state)}.`);
  register("cv_job_cancel_write", jobInputSchema, ASYNC_JOB_HANDLE_SCHEMA, async (parsed) =>
    await jobCancel.execute({ context, club_id: parsed.club_id ?? clubId, job_id: parsed.job_id }) as unknown as Record<string, JsonValue>,
  () => "Der Auftrag wurde abgebrochen.");
  register("cv_file_upload_start_write", uploadStartInputSchema, UPLOAD_HANDLE_SCHEMA, async (parsed) =>
    await uploadStart.execute({ context, request: { ...parsed, club_id: parsed.club_id ?? clubId } }) as unknown as Record<string, JsonValue>,
  () => "Der Upload ist vorbereitet. Übertrage die Bytes per PUT an upload_url und schließe ihn danach ab.");
  register("cv_file_upload_complete_write", uploadCompleteInputSchema, UPLOAD_HANDLE_SCHEMA, async (parsed) =>
    await uploadComplete.execute({ context, club_id: parsed.club_id ?? clubId, upload_id: parsed.upload_id, completion: parsed.completion }) as unknown as Record<string, JsonValue>,
  (output) => `Der Upload ist im Zustand ${String(output.state)}.`);
  register("cv_file_get_read", fileGetInputSchema, CONNECTOR_FILE_REFERENCE_SCHEMA, async (parsed) =>
    await fileGet.execute({ context, club_id: parsed.club_id ?? clubId, file_id: parsed.file_id }) as unknown as Record<string, JsonValue>,
  () => "Die Datei steht über eine kurzlebige Download-Adresse bereit.");

  return (Object.keys(JOB_FILE_TOOLS) as JobFileToolName[]).map((name) => ({
    name,
    title: JOB_FILE_TOOLS[name].title,
    description: JOB_FILE_TOOLS[name].description,
    required_scopes: [...JOB_FILE_TOOLS[name].scopes],
    read_only: JOB_FILE_TOOLS[name].risk_class === "read",
    risk_class: JOB_FILE_TOOLS[name].risk_class,
  }));
}
