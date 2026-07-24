import { randomUUID } from "node:crypto";

import type { CAC } from "cac";

import { AuthError, loadState } from "../auth.ts";
import { output, renderTable } from "../format.ts";
import {
  CliConnectorClient,
  connectorActionToolName,
  connectorToolActionId,
} from "../mcp/client.ts";
import { readJsonFile } from "../util/file.ts";

type Options = {
  file?: string;
  input?: string;
  idempotencyKey?: string;
  previewId?: string;
  confirmationToken?: string;
  json?: boolean;
};

function parseInput(options: Options): Record<string, unknown> {
  if (options.file && options.input) {
    throw new Error("--file und --input dürfen nicht gemeinsam verwendet werden.");
  }
  const value = options.file
    ? readJsonFile<unknown>(options.file)
    : options.input
      ? JSON.parse(options.input) as unknown
      : {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die Action-Eingabe muss ein JSON-Objekt sein.");
  }
  if (
    Object.hasOwn(value, "club_id")
    || Object.hasOwn(value, "subject_id")
    || Object.hasOwn(value, "scopes")
  ) {
    throw new Error(
      "Verein, Benutzer und Scopes werden ausschließlich aus OAuth abgeleitet.",
    );
  }
  return value as Record<string, unknown>;
}

async function connector(): Promise<CliConnectorClient> {
  const state = await loadState();
  if (state.authMode !== "oauth" || !state.oauth?.resource) {
    throw new AuthError(
      "Der typisierte Connector benötigt eine OAuth-Anmeldung. "
      + 'Führe "comvenio login" ohne --device-token aus.',
    );
  }
  return new CliConnectorClient({
    endpoint: state.oauth.resource,
    access_token: state.token,
  });
}

export function registerActionCommands(cli: CAC): void {
  cli
    .command(
      "action <verb> [actionId]",
      "Kanonische Comvenio-Capabilities sicher über den CLI-MCP-Kanal ausführen",
    )
    .option("--file <path>", "Strikt typisierte Action-Eingabe als JSON-Datei")
    .option("--input <json>", "Strikt typisierte Action-Eingabe als JSON-Objekt")
    .option("--idempotency-key <uuid>", "Stabiler Schlüssel für Schreibaktionen")
    .option("--preview-id <uuid>", "Vorschau-ID für action confirm")
    .option("--confirmation-token <token>", "Einmaliges Bestätigungstoken")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (
      verb: string,
      actionId: string | undefined,
      options: Options,
    ) => {
      const client = await connector();
      if (verb === "list") {
        const actions = (await client.listTools())
          .map((tool) => ({
            action_id: connectorToolActionId(tool),
            tool: tool.name,
            title: tool.title ?? null,
            description: tool.description ?? null,
            input_schema: tool.inputSchema ?? null,
            annotations: tool.annotations ?? null,
          }))
          .filter((entry): entry is typeof entry & { action_id: string } =>
            entry.action_id !== null);
        output(actions, options.json, () =>
          renderTable(actions, [
            { header: "Action-ID", width: 64, get: (entry) => entry.action_id },
            { header: "Tool", width: 64, get: (entry) => entry.tool },
            { header: "Titel", width: 50, get: (tool) => tool.title ?? "–" },
          ]));
        return;
      }
      if (verb === "call") {
        if (!actionId) {
          throw new Error("action call benötigt eine kanonische Action-ID.");
        }
        const input = parseInput(options);
        const tools = await client.listTools();
        const toolName = connectorActionToolName(actionId);
        const tool = tools.find((entry) => entry.name === toolName);
        if (!tool) {
          throw new Error(
            "Diese Action ist im aktuellen OAuth-, Vereins- und Rechtekontext nicht freigegeben.",
          );
        }
        const annotations = tool.annotations !== null && typeof tool.annotations === "object"
          ? tool.annotations as Record<string, unknown>
          : {};
        const readOnly = annotations.readOnlyHint === true;
        const idempotencyKey = readOnly
          ? undefined
          : options.idempotencyKey ?? randomUUID();
        const result = await client.callAction({
          action_id: actionId,
          input,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        });
        output(
          idempotencyKey ? { ...result, idempotency_key: idempotencyKey } : result,
          options.json,
          () => JSON.stringify(result, null, 2),
        );
        return;
      }
      if (verb === "confirm") {
        if (
          !options.previewId
          || !options.confirmationToken
          || !options.idempotencyKey
        ) {
          throw new Error(
            "action confirm benötigt --preview-id, --confirmation-token und --idempotency-key.",
          );
        }
        const result = await client.confirm({
          preview_id: options.previewId,
          confirmation_token: options.confirmationToken,
          idempotency_key: options.idempotencyKey,
        });
        output(result, options.json, () => JSON.stringify(result, null, 2));
        return;
      }
      throw new Error('action unterstützt "list", "call" und "confirm".');
    });
}
