import type { CAC } from "cac";

import { loadState } from "../auth.ts";
import { PublicCliError } from "../errors.ts";
import { output } from "../format.ts";
import { createClient } from "../http.ts";
import { requireClubId } from "../util/club.ts";
import { evidenceApprovalId, readAgentEvidence } from "../util/agent-evidence.ts";
import type { CliConnectorClient } from "../mcp/client.ts";
import { connector } from "./action.ts";
import { removedCommandError } from "./removed.ts";

type AgentChatOptions = {
  club?: string;
  session?: string;
  json?: boolean;
};

/** An approval request a chat turn created or touched; decided in web or app only (D-AF-16). */
export type ApprovalRef = { approval_id: string; state?: string; approval_url?: string };

/** A run a chat turn created or advanced (command run, plan run). */
export type RunRef = { run_id: string; kind?: string; state?: string | null };

/** The answer of cv_club_agent_converse as `agent chat --json` prints it (K2 DC-5). */
export type ClubAgentChatResponse = {
  session_id: string;
  response: string;
  run_refs: RunRef[];
  approval_refs: ApprovalRef[];
};

/** Connector tool behind `agent chat` (Geräte-Token-Abbau K2, D-GTA-03). */
export const CLUB_AGENT_TOOL = "cv_club_agent_converse";
const CLUB_AGENT_SCOPE = "club.read";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Tool arguments of cv_club_agent_converse. Club and user come from the OAuth
 * grant on the gateway; the CLI never sends them.
 */
export function buildClubAgentConverseArguments(input: {
  message: string;
  sessionId?: string;
}): { message: string; session_id?: string } {
  const message = input.message.trim();
  if (!message) throw new Error("agent chat benötigt eine Nachricht.");
  if (message.length > 4000) {
    throw new Error("agent chat akzeptiert höchstens 4000 Zeichen.");
  }
  if (input.sessionId && !UUID_PATTERN.test(input.sessionId)) {
    throw new Error("--session muss eine gültige UUID sein.");
  }
  return {
    message,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
  };
}

export const AGENT_ACTIONS = ["chat", "evidence"] as const;

/** Resolve `agent <action> [...message]` to the chat message (throws on unknown or removed action). */
export function resolveAgentChatMessage(action: string, words: string[] | undefined): string {
  if (action === "approval") throw removedCommandError("agent approval");
  if (action !== "chat") {
    throw new Error(`Unbekannte agent-Aktion "${action}". Erlaubt: ${AGENT_ACTIONS.join(", ")}.`);
  }
  return (words ?? []).join(" ");
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Reads the tool answer; references come from their fields, never from the text (§17). */
export function parseClubAgentAnswer(value: Record<string, unknown>): ClubAgentChatResponse {
  if (typeof value.session_id !== "string" || typeof value.response !== "string") {
    throw new PublicCliError(
      "UPSTREAM_UNAVAILABLE",
      "Die Antwort des Club-Agenten ist unvollständig.",
    );
  }
  const runRefs = (Array.isArray(value.run_refs) ? value.run_refs : [])
    .map(object)
    .filter((ref): ref is Record<string, unknown> => typeof ref?.run_id === "string")
    .map((ref) => ({
      run_id: ref.run_id as string,
      ...(typeof ref.kind === "string" ? { kind: ref.kind } : {}),
      ...(typeof ref.state === "string" || ref.state === null ? { state: ref.state as string | null } : {}),
    }));
  const approvalRefs = (Array.isArray(value.approval_refs) ? value.approval_refs : [])
    .map(object)
    .filter((ref): ref is Record<string, unknown> => typeof ref?.approval_id === "string")
    .map((ref) => ({
      approval_id: ref.approval_id as string,
      ...(typeof ref.state === "string" ? { state: ref.state } : {}),
      ...(typeof ref.approval_url === "string" ? { approval_url: ref.approval_url } : {}),
    }));
  return {
    session_id: value.session_id,
    response: value.response,
    run_refs: runRefs,
    approval_refs: approvalRefs,
  };
}

/**
 * One chat turn over the connector (`/cli` channel, OAuth). The scope is
 * checked locally first; a tool missing from the list means the club agent is
 * not available for this club (CLUB_AGENT_NOT_READY), not a typo.
 */
export async function runAgentChat(input: {
  client: Pick<CliConnectorClient, "listTools" | "callTool">;
  granted_scopes: readonly string[];
  message: string;
  sessionId?: string;
}): Promise<ClubAgentChatResponse> {
  const args = buildClubAgentConverseArguments({
    message: input.message,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  if (!input.granted_scopes.includes(CLUB_AGENT_SCOPE)) {
    throw new PublicCliError(
      "SCOPE_REQUIRED",
      "Für den Club-Agenten fehlt der Anmeldung ein Scope.",
      { required_scopes: [CLUB_AGENT_SCOPE] },
    );
  }
  const tools = await input.client.listTools();
  if (!tools.some((tool) => tool.name === CLUB_AGENT_TOOL)) {
    throw new PublicCliError(
      "CLUB_AGENT_NOT_READY",
      "Der Club-Agent ist für deinen Verein über diese Anmeldung nicht verfügbar.",
    );
  }
  return parseClubAgentAnswer(await input.client.callTool(CLUB_AGENT_TOOL, args));
}

const STATE_LABELS: Record<string, string> = {
  open: "offen",
  approved: "freigegeben",
  rejected: "abgelehnt",
  expired: "abgelaufen",
  superseded: "ersetzt",
};

/** Text answer: the reply, one line per approval link and per run, then the session (DC-8). */
export function formatChatResponse(response: ClubAgentChatResponse): string {
  const refs = response.approval_refs
    .filter((ref) => ref.approval_url)
    .map((ref) => `Freigabe (${STATE_LABELS[ref.state ?? "open"] ?? ref.state}): ${ref.approval_url}`);
  const runs = response.run_refs.map(
    (ref) => `Lauf ${ref.kind === "plan_run" ? "Routine" : "Kommando"} ${ref.run_id}: ${ref.state === "succeeded" ? "ausgeführt — Wirkung nicht separat bestätigt" : ref.state ?? "–"}`,
  );
  const text = response.response.trim();
  return [...(text ? [text, ""] : []), ...refs, ...runs, `Session: ${response.session_id}`].join("\n");
}

/**
 * The club agent opens a new conversation instead of failing when --session
 * names none of the person's conversations; say so rather than pretend the
 * turn continued the old one (K2 DC-3, TC-06).
 */
export function sessionLostHint(requested: string | undefined, response: ClubAgentChatResponse): string | null {
  if (!requested || requested.toLowerCase() === response.session_id.toLowerCase()) return null;
  return `Hinweis: Zur Session ${requested} gibt es keine Unterhaltung; der Club-Agent hat eine neue begonnen (Session: ${response.session_id}).`;
}

export function registerAgentCommands(cli: CAC): void {
  // cac matches only the FIRST word as command name: "agent chat <message>" was
  // never reachable (silent exit 0). One word plus an action, like weekly-preview.
  cli
    .command(
      "agent <action> [...message]",
      "Club-Agent: chat <nachricht> — mit dem vereinseigenen Club-Agenten sprechen (über die Anmeldung mit comvenio login); Freigaben entscheidest du nur per Link in Web oder App; evidence <id> — vorhandenen DEV-Prüfbeleg lesen",
    )
    .option(
      "--session <id>",
      "Session-ID der vorherigen Antwort für Rückfragen und Korrekturen (ein getipptes „ja“ gibt nichts frei)",
    )
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, words: string[], opts: AgentChatOptions) => {
      if (action === "evidence") {
        const approvalId = evidenceApprovalId(words);
        const state = await loadState();
        const result = await readAgentEvidence(createClient(state), requireClubId(state, opts.club), approvalId);
        output(result, opts.json, () => "Gespräch, Freigabe, Ausführung und Nachlese sind miteinander verknüpft.");
        return;
      }
      const message = resolveAgentChatMessage(action, words);
      if (opts.club !== undefined) {
        throw new Error("--club gilt für agent chat nicht: Der Verein kommt aus der Anmeldung (comvenio login).");
      }
      const client = await connector("Der Club-Agent braucht");
      const state = await loadState();
      const response = await runAgentChat({
        client,
        granted_scopes: state.oauth?.scopes ?? [],
        message,
        ...(opts.session ? { sessionId: opts.session } : {}),
      });
      const lost = sessionLostHint(opts.session, response);
      // stderr keeps --json machine-readable.
      if (lost) console.error(lost);
      output(response, opts.json, () => formatChatResponse(response));
    });
}
