import { describe, expect, test } from "bun:test";
import cac from "cac";

import {
  formatFunctionList,
  formatFunctionRun,
  functionListPath,
  parseFunctionArgs,
  registerFunctionCommands,
  resolveFunctionCommand,
} from "../src/commands/function.ts";

describe("comvenio function (Agent-Funktionen K2, Strang 02 §11)", () => {
  test("`function run <id> --args` reaches the command", () => {
    const cli = cac("comvenio");
    registerFunctionCommands(cli);
    cli.parse(["bun", "comvenio", "function", "run", "weekly_preview.create", "--args", "{\"x\":1}"], { run: false });
    expect(cli.matchedCommandName).toBe("function");
    expect(cli.args).toEqual(["run", "weekly_preview.create"]);
    expect(cli.options.args).toBe("{\"x\":1}");
  });

  test("actions, capability ids and run ids are checked before any API call", () => {
    expect(resolveFunctionCommand("list", undefined)).toEqual({ action: "list" });
    expect(resolveFunctionCommand("run", "task.create")).toEqual({ action: "run", target: "task.create" });
    expect(() => resolveFunctionCommand("run", "../admin")).toThrow("Kennung der Funktion");
    expect(() => resolveFunctionCommand("show", "abc")).toThrow("UUID");
    expect(() => resolveFunctionCommand("call", "task.create")).toThrow("list, run, show");
    expect(() => resolveFunctionCommand("list", "x")).toThrow("kein Ziel");
  });

  test("the intent must be a JSON object", () => {
    expect(parseFunctionArgs(undefined)).toEqual({});
    expect(parseFunctionArgs("{\"title\":\"Sommerfest\"}")).toEqual({ title: "Sommerfest" });
    expect(() => parseFunctionArgs("[1]")).toThrow("JSON-Objekt");
    expect(() => parseFunctionArgs("{kaputt")).toThrow("gültiges JSON");
  });

  test("list and run read like the web", () => {
    const list = formatFunctionList([{
      capability_id: "task.create", title: "Aufgabe anlegen", description: "", risk_level: 2,
      approval_required: true, input_schema: { type: "object", required: ["title"] }, capability_version: 1,
    }]);
    expect(list).toContain("task.create — Aufgabe anlegen · braucht Freigabe");
    expect(list).toContain("Pflicht: title");
    const waiting = formatFunctionRun({
      id: "r1", capability_id: "task.create", state: "awaiting_approval", channel: "cli", idempotency_key: "k",
      args: {}, approval: { approval_id: "a1", approval_url: "https://comvenio.app/club/c?approval=a1" },
      created_at: "2026-09-24T12:00:00Z",
    });
    expect(waiting).toContain("wartet auf Freigabe");
    expect(waiting).toContain("entscheide in Web oder App: https://comvenio.app/club/c?approval=a1");
  });
});

describe("function list --channel", () => {
  test("adds the channel only when one is asked for", () => {
    expect(functionListPath("c1", undefined)).toBe("/club-agents/c1/functions");
    expect(functionListPath("c1", "mcp")).toBe("/club-agents/c1/functions?channel=mcp");
  });
  test("rejects an unknown channel before any request", () => {
    expect(() => functionListPath("c1", "fax")).toThrow("--channel kennt nur web, cli, mcp.");
  });
});
