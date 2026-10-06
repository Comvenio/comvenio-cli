// K16 (community-hub, PROD test 2026-10-06): CLI findings around the
// community actions — input errors as VALIDATION_FAILED with the field, the
// confirm command with the same key, input fields per action, screenshots on disk.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { formatActionDescription, formatCallText, inputVariants, saveScreenshots } from "../src/commands/action-output.ts";
import { formatCliError, inputValidationDetail, toPublicError } from "../src/errors.ts";
import { CliConnectorClient, ConnectorClientError } from "../src/mcp/client.ts";

// The text the MCP SDK sends back when the tool input fails its schema
// (McpError InvalidParams around the zod message), built from a real zod error.
function sdkValidationText(): string {
  const schema = z.object({
    input: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("private"), community_id: z.string() }),
      z.object({ operation: z.literal("public"), slug: z.string() }),
    ]),
  });
  const parsed = schema.safeParse({ input: { community_id: "c1" } });
  if (parsed.success) throw new Error("fixture must fail");
  return `MCP error -32602: Input validation error: Invalid arguments for tool cai_community_01_show: ${parsed.error.message}`;
}

describe("(a) missing required field", () => {
  test("is VALIDATION_FAILED naming input.operation, not UNKNOWN_ERROR", () => {
    const rendered = toPublicError(new ConnectorClientError(sdkValidationText()), { lang: "de" });
    expect(rendered.code).toBe("VALIDATION_FAILED");
    expect(rendered.detail).toStartWith("input.operation: ");
    expect(rendered.next_command).toBe("comvenio action list --json");
    expect(formatCliError(rendered).split("\n")[0]).toStartWith("Fehler VALIDATION_FAILED: ");
  });

  test("unreadable issue list keeps the sentence after the marker", () => {
    expect(inputValidationDetail("MCP error -32602: Input validation error: kaputt")).toBe("kaputt");
  });

  test("a structured connector answer keeps its own code", () => {
    const error = new ConnectorClientError("Input validation error", { error: "conflict", code: "CONFLICT" });
    expect(toPublicError(error, { lang: "de" }).code).toBe("CONFLICT");
  });
});

describe("(b) confirm with the same idempotency key", () => {
  test("text output prints the complete confirm command with the key of the call", () => {
    const text = formatCallText({
      status: "confirmation_required",
      confirmation: { preview_id: "p-1", confirmation_token: "tok", idempotency_key: "k-1" },
    }, "k-1");
    expect(text).toContain("comvenio action confirm --preview-id p-1 --confirmation-token tok --idempotency-key k-1");
  });

  test("a write without confirmation still names its key", () => {
    expect(formatCallText({ status: "completed" }, "k-2")).toContain("Idempotenzschlüssel: k-2");
  });

  test("a read prints only the answer", () => {
    expect(formatCallText({ status: "completed" }, undefined)).toBe(JSON.stringify({ status: "completed" }, null, 2));
  });
});

describe("(c) input fields of an action", () => {
  const inputSchema = z.toJSONSchema(z.object({
    input: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("show"), community_id: z.string().describe("Kennung der Community") }),
      z.object({ operation: z.literal("update"), community_id: z.string(), expected_design_version: z.number().optional() }),
    ]),
    idempotency_key: z.string().optional(),
  }));

  test("one variant per operation with required and optional fields", () => {
    expect(inputVariants(inputSchema)).toEqual([
      { operation: "show", fields: [{ name: "community_id", type: "string", required: true, description: "Kennung der Community" }] },
      {
        operation: "update",
        fields: [
          { name: "community_id", type: "string", required: true, description: null },
          { name: "expected_design_version", type: "number", required: false, description: null },
        ],
      },
    ]);
  });

  test("the text names operation and fields", () => {
    const text = formatActionDescription("cai.community.05.design", { name: "x", title: "Design", inputSchema });
    expect(text).toContain('"operation": "show"');
    expect(text).toContain("community_id (string, Pflicht) — Kennung der Community");
    expect(text).toContain("expected_design_version (number, optional)");
  });
});

describe("(d) screenshots", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  test("the client keeps the image blocks of the answer", async () => {
    const client = new CliConnectorClient({
      endpoint: "https://mcp.comvenio.app/cli",
      access_token: "token",
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "{}" }, { type: "image", data: "aGFsbG8=", mimeType: "image/png" }],
            structuredContent: { result: { screenshots: [{ viewport: "desktop", data_in_content: true }] } },
          },
        });
      }) as typeof fetch,
    });
    const answer = await client.callActionWithImages({ action_id: "cai.community.04.screenshot", input: {} });
    expect(answer.images).toEqual([{ data: "aGFsbG8=", mime_type: "image/png" }]);
  });

  test("images land on disk and each entry names its file", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const result = saveScreenshots(
      { result: { preview_id: "p-1", screenshots: [{ viewport: "desktop", width: 1440, data_in_content: true }, { viewport: "mobile", data_in_content: true }] } },
      [{ data: Buffer.from("eins").toString("base64"), mime_type: "image/png" }, { data: Buffer.from("zwei").toString("base64"), mime_type: "image/jpeg" }],
      { cwd: dir },
    );
    const shots = (result.result as { screenshots: Record<string, unknown>[] }).screenshots;
    expect(shots[0]).toEqual({ viewport: "desktop", width: 1440, file: join(".comvenio-screenshots", "p-1", "1-desktop.png") });
    expect(shots[1]!.file).toBe(join(".comvenio-screenshots", "p-1", "2-mobile.jpg"));
    expect(readFileSync(join(dir, shots[0]!.file as string), "utf8")).toBe("eins");
    expect(result.screenshot_files).toEqual([shots[0]!.file, shots[1]!.file]);
  });

  test("without images nothing is written", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const answer = { result: { screenshots: [] } };
    expect(saveScreenshots(answer, [], { cwd: dir })).toBe(answer);
    expect(existsSync(join(dir, ".comvenio-screenshots"))).toBe(false);
  });

  test("an unsafe preview id never becomes a path", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const result = saveScreenshots(
      { result: { preview_id: "../../etc", screenshots: [{ viewport: "../x", data_in_content: true }] } },
      [{ data: "eA==", mime_type: "image/png" }],
      { cwd: dir, now: new Date("2026-10-06T20:00:00Z") },
    );
    const file = (result.result as { screenshots: Record<string, unknown>[] }).screenshots[0]!.file as string;
    expect(file).toBe(join(".comvenio-screenshots", "2026-10-06T20-00-00-000Z", "1-1.png"));
  });
});
