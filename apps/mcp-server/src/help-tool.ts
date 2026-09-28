// comvenio_hilfe (05-ki-zugang): the customer documentation for AI assistants —
// search, articles and error codes, public (public.read, noauth) and without a
// club. The same embedded articles as `comvenio help` (@comvenio/kundendoku),
// plus one MCP resource per article: comvenio://hilfe/<lang>/<id>.
import {
  article,
  findById,
  findError,
  findTopic,
  INDEX,
  search,
  type DocArticle,
  type DocLang,
  type IndexEntry,
} from "@comvenio/kundendoku";
import { createProviderNeutralResult, type JsonValue, type RequestContext } from "@comvenio/connector-contracts";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ToolSecurityScheme } from "./tool-security-schemes.ts";

export const HELP_TOOL_NAME = "comvenio_hilfe";

/** Sentence other tool descriptions carry, so assistants find the help on errors (05 §4.3). */
export const HELP_TOOL_HINT = "Bei Fehlern erklärt comvenio_hilfe (operation fehler) den Code und den nächsten Schritt.";

export const HELP_TOOL_COPY = Object.freeze({
  title: "Comvenio: Hilfe und Fehlercodes",
  description:
    "Öffentliche Kunden-Dokumentation von Comvenio, ohne Anmeldung und ohne Vereinsdaten. "
    + "operation suche (text) findet Artikel, leer eine Übersicht; operation artikel (id) liefert einen Artikel; "
    + "operation fehler (code) erklärt einen Fehlercode wie SCOPE_REQUIRED mit Ursache und nächstem Schritt. "
    + "lang de oder en, Standard de. Ergebnis: { id, title, lang, markdown, related }.",
});

export const HELP_TOOL_INPUT_SCHEMA = z.object({
  operation: z.enum(["suche", "artikel", "fehler"]),
  text: z.string().max(200).optional(),
  id: z.string().max(120).optional(),
  code: z.string().max(60).optional(),
  lang: z.enum(["de", "en"]).optional(),
}).strict();

export function helpResourceUri(lang: DocLang, id: string): string {
  return `comvenio://hilfe/${lang}/${id}`;
}

function listing(entries: readonly IndexEntry[], lang: DocLang): JsonValue[] {
  return entries.map((entry) => ({ id: entry.id, kategorie: entry.kategorie, title: entry.title[lang] }));
}

function found(context: RequestContext, result: DocArticle): CallToolResult {
  const output = { ...result, related: [...result.related] };
  return {
    ...createProviderNeutralResult(context, output, [{ type: "text", text: result.markdown }]),
    structuredContent: output,
  };
}

function notFound(context: RequestContext, what: string, hits: readonly IndexEntry[], lang: DocLang): CallToolResult {
  const matches = listing(hits.slice(0, 5), lang);
  return {
    content: [{
      type: "text",
      text: `Fehler NOT_FOUND: ${what} ist nicht bekannt. Nächste Treffer stehen in matches; operation suche findet weitere.`,
    }],
    structuredContent: { error: "not_found", code: "NOT_FOUND", request_id: context.request_id, matches },
    _meta: { request_id: context.request_id },
    isError: true,
  };
}

/** Answers one call; pure apart from the embedded articles. */
export function answerHelp(context: RequestContext, arguments_: unknown): CallToolResult {
  const input = HELP_TOOL_INPUT_SCHEMA.parse(arguments_ ?? {});
  const lang: DocLang = input.lang ?? "de";
  if (input.operation === "fehler") {
    const entry = input.code ? findError(input.code) : null;
    if (entry) return found(context, article(entry, lang));
    return notFound(context, `Der Fehlercode „${input.code ?? ""}“`, INDEX.filter((candidate) => candidate.kategorie === "fehler"), lang);
  }
  if (input.operation === "artikel") {
    const entry = input.id ? findById(input.id) ?? findTopic(input.id) : null;
    if (entry) return found(context, article(entry, lang));
    return notFound(context, `Der Artikel „${input.id ?? ""}“`, search(input.id ?? "", lang), lang);
  }
  const text = input.text?.trim() ?? "";
  // An empty search is the overview of all articles by category (DC-3).
  const hits = text ? search(text, lang).slice(0, 10) : [...INDEX];
  const output = { lang, text, results: listing(hits, lang) };
  return {
    ...createProviderNeutralResult(context, output, [{
      type: "text",
      text: hits.length > 0
        ? hits.map((entry) => `${entry.id} — ${entry.title[lang]}`).join("\n")
        : `Keine Treffer für „${text}“.`,
    }]),
    structuredContent: output,
  };
}

/** Registers the public tool and one resource per article and language. */
export function registerHelpTool(input: {
  server: McpServer;
  context: RequestContext;
  advertised_security_schemes: Map<string, readonly ToolSecurityScheme[]>;
  with_security_metadata: (schemes: ToolSecurityScheme[]) => Record<string, unknown>;
}): void {
  const securitySchemes: ToolSecurityScheme[] = [{ type: "noauth" }];
  input.advertised_security_schemes.set(HELP_TOOL_NAME, securitySchemes);
  registerAppTool(input.server, HELP_TOOL_NAME, {
    ...HELP_TOOL_COPY,
    inputSchema: HELP_TOOL_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: input.with_security_metadata(securitySchemes),
  }, async (arguments_) => answerHelp(input.context, arguments_));

  for (const entry of INDEX) {
    for (const lang of ["de", "en"] as const) {
      const uri = helpResourceUri(lang, entry.id);
      input.server.registerResource(`comvenio-hilfe-${lang}-${entry.id.replace("/", "-")}`, uri, {
        title: entry.title[lang],
        description: lang === "de" ? "Comvenio-Hilfeartikel (öffentlich)" : "Comvenio help article (public)",
        mimeType: "text/markdown",
      }, async () => ({
        contents: [{ uri, mimeType: "text/markdown", text: article(entry, lang).markdown }],
      }));
    }
  }
}
