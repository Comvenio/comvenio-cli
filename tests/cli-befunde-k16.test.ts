// K16 (community-hub, PROD test 2026-10-06): CLI findings around the
// community actions — input errors as VALIDATION_FAILED with the field, the
// confirm command with the same key, input fields per action, screenshots on disk.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { formatActionDescription, formatCallText, inputVariants, saveScreenshots } from "../src/commands/action-output.ts";
import { formatCliError, toPublicError } from "../src/errors.ts";
import { CliConnectorClient, ConnectorClientError, inputValidationDetail } from "../src/mcp/client.ts";

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

function connectorAnswering(answer: (body: { id: string }) => unknown) {
  return new CliConnectorClient({
    endpoint: "https://mcp.comvenio.app/cli",
    access_token: "token",
    fetch: (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return Response.json({ jsonrpc: "2.0", id: body.id, ...(answer(body) as object) });
    }) as typeof fetch,
  });
}

describe("(a) missing required field", () => {
  test("the SDK input check of a tool answer is VALIDATION_FAILED naming input.operation", async () => {
    const client = connectorAnswering(() => ({
      result: { isError: true, content: [{ type: "text", text: sdkValidationText() }] },
    }));
    const error = await client.callAction({ action_id: "cai.community.01.show", input: {} }).catch((e: unknown) => e);
    const rendered = toPublicError(error, { lang: "de" });
    expect(rendered.code).toBe("VALIDATION_FAILED");
    expect(rendered.detail).toStartWith("input.operation: ");
    expect(rendered.next_command).toBe("comvenio action list --json");
    expect(formatCliError(rendered).split("\n")[0]).toStartWith("Fehler VALIDATION_FAILED: ");
  });

  test("a JSON-RPC error with the same words keeps its own way (no guess from text)", async () => {
    const client = connectorAnswering(() => ({ error: { code: -32000, message: sdkValidationText(), data: "x" } }));
    const error = await client.callAction({ action_id: "cai.community.01.show", input: {} }).catch((e: unknown) => e);
    expect(toPublicError(error, { lang: "de" }).code).not.toBe("VALIDATION_FAILED");
  });

  test("a plain ConnectorClientError with the words is not reclassified", () => {
    expect(toPublicError(new ConnectorClientError(sdkValidationText()), { lang: "de" }).code).toBe("UNKNOWN_ERROR");
  });

  test("unreadable issue list keeps the sentence after the prefix", () => {
    expect(inputValidationDetail("MCP error -32602: Input validation error: kaputt")).toBe("kaputt");
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

  const twoShots = () => ({ result: { preview_id: "p-1", screenshots: [{ viewport: "desktop", width: 1440, data_in_content: true }, { viewport: "mobile", data_in_content: true }] } });
  const twoImages = [{ data: Buffer.from("eins").toString("base64"), mime_type: "image/png" }, { data: Buffer.from("zwei").toString("base64"), mime_type: "image/jpeg" }];

  test("without --screenshots nothing is written and the answer names the option", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const result = saveScreenshots(twoShots(), twoImages, { cwd: dir });
    expect(result.screenshots_not_saved).toContain("--screenshots");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("with --screenshots images land in their own folder and each entry names its file", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const now = new Date("2026-10-06T20:00:00Z");
    const result = saveScreenshots(twoShots(), twoImages, { cwd: dir, dir: "bilder", now });
    const shots = (result.result as { screenshots: Record<string, unknown>[] }).screenshots;
    const folder = join("bilder", "p-1-2026-10-06T20-00-00-000Z");
    expect(shots[0]).toEqual({ viewport: "desktop", width: 1440, file: join(folder, "1.png") });
    expect(shots[1]!.file).toBe(join(folder, "2.jpg"));
    expect(readFileSync(join(dir, shots[0]!.file as string), "utf8")).toBe("eins");
    expect(result.screenshot_files).toEqual([shots[0]!.file, shots[1]!.file]);
  });

  test("a second call never overwrites the first", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const now = new Date("2026-10-06T20:00:00Z");
    saveScreenshots(twoShots(), twoImages, { cwd: dir, dir: "bilder", now });
    expect(() => saveScreenshots(twoShots(), twoImages, { cwd: dir, dir: "bilder", now })).toThrow();
    const later = saveScreenshots(twoShots(), twoImages, { cwd: dir, dir: "bilder", now: new Date("2026-10-06T20:00:01Z") });
    expect((later.screenshot_files as string[])[0]).toContain("20-00-01");
    expect(readFileSync(join(dir, "bilder", "p-1-2026-10-06T20-00-00-000Z", "1.png"), "utf8")).toBe("eins");
  });

  test("a different number of images and entries names no file in the entries and warns", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const result = saveScreenshots(twoShots(), [twoImages[0]!], { cwd: dir, dir: "bilder" });
    expect(result.screenshot_warning).toContain("nicht eindeutig");
    expect((result.result as { screenshots: Record<string, unknown>[] }).screenshots[0]!.file).toBeUndefined();
    expect(result.screenshot_files).toHaveLength(1);
  });

  test("without images nothing happens", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const answer = { result: { screenshots: [] } };
    expect(saveScreenshots(answer, [], { cwd: dir, dir: "bilder" })).toBe(answer);
    expect(existsSync(join(dir, "bilder"))).toBe(false);
  });

  test("an unsafe preview id never becomes a path", () => {
    dir = mkdtempSync(join(tmpdir(), "k16-"));
    const result = saveScreenshots(
      { result: { preview_id: "../../etc", screenshots: [{ viewport: "../x", data_in_content: true }] } },
      [{ data: "eA==", mime_type: "image/png" }],
      { cwd: dir, dir: "bilder", now: new Date("2026-10-06T20:00:00Z") },
    );
    const file = (result.result as { screenshots: Record<string, unknown>[] }).screenshots[0]!.file as string;
    expect(file).toBe(join("bilder", "screenshots-2026-10-06T20-00-00-000Z", "1.png"));
  });
});
