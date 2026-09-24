import type { CAC } from "cac";

import { loadState } from "../auth.ts";
import { output } from "../format.ts";
import { createClient } from "../http.ts";
import { requireClubId } from "../util/club.ts";

type AgentChatOptions = {
  club?: string;
  session?: string;
  json?: boolean;
};

type ClubAgentChatResponse = {
  session_id: string;
  response: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function buildClubAgentChatPayload(input: {
  message: string;
  clubId: string;
  sessionId?: string;
}): {
  message: string;
  club_id: string;
  context_type: "club_agent_dm";
  surface: "cli";
  session_id?: string;
} {
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
    club_id: input.clubId,
    context_type: "club_agent_dm",
    surface: "cli",
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
  };
}

export const AGENT_ACTIONS = ["chat"] as const;

/** Resolve `agent <action> [...message]` to the chat message (throws on unknown action). */
export function resolveAgentChatMessage(action: string, words: string[] | undefined): string {
  if (action !== "chat") {
    throw new Error(`Unbekannte agent-Aktion "${action}". Erlaubt: ${AGENT_ACTIONS.join(", ")}.`);
  }
  return (words ?? []).join(" ");
}

export function registerAgentCommands(cli: CAC): void {
  // cac matches only the FIRST word as command name: "agent chat <message>" was
  // never reachable (silent exit 0). One word plus an action, like weekly-preview.
  cli
    .command(
      "agent <action> [...message]",
      "Club-Agent: chat <nachricht> — mit dem vereinseigenen Club-Agenten sprechen; für komplexe Planung und mehrstufige Aufgaben",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option(
      "--session <id>",
      "Session-ID der vorherigen Antwort für Rückfragen, Korrekturen und Freigaben",
    )
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, words: string[], opts: AgentChatOptions) => {
      const message = resolveAgentChatMessage(action, words);
      const state = await loadState();
      const clubId = requireClubId(state, opts.club);
      const client = createClient(state);
      const response = await client.post<ClubAgentChatResponse>(
        "ai",
        "/chat/?streaming=false",
        buildClubAgentChatPayload({
          message,
          clubId,
          sessionId: opts.session,
        }),
        { timeoutMs: 120_000 },
      );
      output(
        response,
        opts.json,
        () => `${response.response}\n\nSession: ${response.session_id}`,
      );
    });
}
