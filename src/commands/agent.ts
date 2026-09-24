import type { CAC } from "cac";

import { loadState } from "../auth.ts";
import { output } from "../format.ts";
import { createClient } from "../http.ts";
import { requireClubId } from "../util/club.ts";

type AgentChatOptions = {
  club?: string;
  session?: string;
  state?: string;
  json?: boolean;
};

type ApprovalRef = { approval_id: string; state: string; approval_url?: string };

type ClubAgentChatResponse = {
  session_id: string;
  response: string;
  approval_refs?: ApprovalRef[];
};

/** Agent-Funktionen K1 (Strang 01 §11): an approval request as the ai-service returns it. */
export type AgentApproval = {
  id: string;
  capability_id: string;
  capability_title: string;
  arguments_summary: { label: string; value?: unknown }[];
  target_summary?: string | null;
  source: string;
  source_title?: string | null;
  mode: string;
  created_at: string;
  expires_at: string;
  state: string;
  expired_reason?: string | null;
  decision_kind?: string | null;
  decided_at?: string | null;
  reason?: string | null;
  run?: { id?: string | null; state?: string | null; error?: string | null } | null;
  can_decide: boolean;
  approval_url: string;
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

export const AGENT_ACTIONS = ["chat", "approval"] as const;

/** Resolve `agent <action> [...message]` to the chat message (throws on unknown action). */
export function resolveAgentChatMessage(action: string, words: string[] | undefined): string {
  if (action !== "chat") {
    throw new Error(`Unbekannte agent-Aktion "${action}". Erlaubt: ${AGENT_ACTIONS.join(", ")}.`);
  }
  return (words ?? []).join(" ");
}

export const APPROVAL_ACTIONS = ["list", "show", "approve", "reject"] as const;
type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** `agent approval <list|show|approve|reject> [id]` (CLI-16). */
export function resolveApprovalCommand(words: string[] | undefined): { action: ApprovalAction; id?: string } {
  const [action, id, ...rest] = words ?? [];
  if (!APPROVAL_ACTIONS.includes(action as ApprovalAction)) {
    throw new Error(`agent approval braucht eine Aktion: ${APPROVAL_ACTIONS.join(", ")}.`);
  }
  if (rest.length > 0) throw new Error("agent approval nimmt höchstens eine Kennung.");
  if (action === "list") {
    if (id) throw new Error("agent approval list nimmt keine Kennung (Filter: --state).");
    return { action };
  }
  if (!id || !UUID_PATTERN.test(id)) {
    throw new Error(`agent approval ${action} braucht die Kennung der Freigabe (UUID).`);
  }
  return { action: action as ApprovalAction, id };
}

export function approvalListState(state: string | undefined): "open" | "decided" | "all" {
  const value = state ?? "open";
  if (value !== "open" && value !== "decided" && value !== "all") {
    throw new Error("--state muss open, decided oder all sein.");
  }
  return value;
}

const STATE_LABELS: Record<string, string> = {
  open: "offen",
  approved: "freigegeben",
  rejected: "abgelehnt",
  expired: "abgelaufen",
  superseded: "ersetzt",
};

function approvalLine(a: AgentApproval): string {
  const target = a.target_summary ? ` — ${a.target_summary}` : "";
  return `${STATE_LABELS[a.state] ?? a.state} · ${a.capability_title}${target}\n  ${a.id} · ${a.approval_url}`;
}

export function formatApprovalList(items: AgentApproval[]): string {
  if (items.length === 0) return "Keine Freigaben.";
  return items.map(approvalLine).join("\n");
}

export function formatApproval(a: AgentApproval): string {
  const lines = [
    `${a.capability_title} (${STATE_LABELS[a.state] ?? a.state})`,
    ...(a.target_summary ? [`Ziel: ${a.target_summary}`] : []),
    ...a.arguments_summary.map((line) => `  ${line.label}${line.value != null ? `: ${String(line.value)}` : ""}`),
    `Quelle: ${a.source_title ?? a.source} · Art: ${a.mode}`,
    a.state === "open"
      ? `Frist: ${a.expires_at}`
      : `Entschieden: ${a.decided_at ?? "–"} (${a.decision_kind ?? a.expired_reason ?? "–"})`,
    ...(a.reason ? [`Grund: ${a.reason}`] : []),
    ...(a.run?.state ? [`Lauf: ${a.run.state}${a.run.error ? ` (${a.run.error})` : ""}`] : []),
    `Link: ${a.approval_url}`,
  ];
  return lines.join("\n");
}

/** approve/reject never decide from the terminal (D-AF-16): they only point to web/app. */
export function decisionLinkText(action: "approve" | "reject", a: AgentApproval): string {
  if (a.state !== "open") {
    return `Diese Freigabe ist bereits ${STATE_LABELS[a.state] ?? a.state}.\nLink: ${a.approval_url}`;
  }
  const verb = action === "approve" ? "Freigeben" : "Ablehnen";
  return `Freigaben entscheidest du in Web oder App, nicht im Terminal.\nZum ${verb}: ${a.approval_url}`;
}

export function formatChatResponse(response: ClubAgentChatResponse): string {
  const refs = (response.approval_refs ?? [])
    .filter((ref) => ref.approval_url)
    .map((ref) => `Freigabe (${STATE_LABELS[ref.state] ?? ref.state}): ${ref.approval_url}`);
  return [response.response, "", ...refs, `Session: ${response.session_id}`].join("\n");
}

export function registerAgentCommands(cli: CAC): void {
  // cac matches only the FIRST word as command name: "agent chat <message>" was
  // never reachable (silent exit 0). One word plus an action, like weekly-preview.
  cli
    .command(
      "agent <action> [...message]",
      "Club-Agent: chat <nachricht> — mit dem vereinseigenen Club-Agenten sprechen; approval list|show|approve|reject [id] — Freigaben lesen, entschieden wird nur per Link in Web/App",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option(
      "--session <id>",
      "Session-ID der vorherigen Antwort für Rückfragen und Korrekturen (ein getipptes „ja“ gibt nichts frei)",
    )
    .option("--state <state>", "approval list: open (Voreinstellung), decided oder all")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, words: string[], opts: AgentChatOptions) => {
      if (action === "approval") {
        await runApprovalCommand(words, opts);
        return;
      }
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
      // --json passes approval_refs through unchanged (Strang 01 §11).
      output(response, opts.json, () => formatChatResponse(response));
    });
}

/** Reads approval requests; approve/reject only print the direct link (D-AF-16, CLI-16). */
async function runApprovalCommand(words: string[] | undefined, opts: AgentChatOptions): Promise<void> {
  const command = resolveApprovalCommand(words);
  const listState = command.action === "list" ? approvalListState(opts.state) : undefined;
  const state = await loadState();
  const clubId = requireClubId(state, opts.club);
  const client = createClient(state);
  if (command.action === "list") {
    const list = await client.get<{ items: AgentApproval[] }>(
      "ai",
      `/club-agents/${clubId}/approvals?state=${listState}`,
    );
    output(list, opts.json, () => formatApprovalList(list.items));
    return;
  }
  const approval = await client.get<AgentApproval>("ai", `/club-agents/${clubId}/approvals/${command.id}`);
  if (command.action === "show") {
    output(approval, opts.json, () => formatApproval(approval));
    return;
  }
  output(
    { approval_id: approval.id, state: approval.state, approval_url: approval.approval_url },
    opts.json,
    () => decisionLinkText(command.action as "approve" | "reject", approval),
  );
}
