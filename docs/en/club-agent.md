---
id: club-agent
kategorie: thema
domaenen: [agent]
stichwoerter: [club agent, chat, functions, approval, approvals, session, standing approval]
---

# Club agent

## Purpose

The club agent is Comvenio's own, channel-independent assistant for advice, planning and
multi-step tasks in the club — for example planning a volunteer roster or creating a task. CLI,
MCP/ChatGPT, Claude, the app, the web app, voice and further channels are all just surfaces on top
of the same assistant. It is not an alternative data source and not a generic pass-through: every
access runs with the identity of the signed-in person, and the service checks club and rights
again.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login` — the default sign-in covers all scopes, narrow it with `--scopes`.
What chat and functions may actually do additionally depends on the club role. If the club agent
is not yet set up for the club, an administrator of the club must do that in the web app first; in
that case the service responds without internal diagnostic or trace data. Approvals and standing
approvals are created and ended only in the web app or the mobile app, never in the terminal —
standing approvals in the "Capabilities & Routines" tab.

## Workflows

### The three execution levels

The club agent combines three levels: direct data and action commands return structured,
deterministic club data and are preferable for simple questions about events, news, tasks,
members or other single areas. Domain skills bundle known club workflows and enforce their
business preconditions, risk rules and approval rules. The agent itself handles advice, planning,
proactive hints and multi-step tasks; a stored tool and capability overview determines which
skills are actually executable.

### Talking to the club agent

1. Send a message: `comvenio agent chat "<message>"`.
2. The response carries a session ID.
3. For follow-ups and corrections, reuse the same session:
   `comvenio agent chat "<message>" --session <session-id>`.

The CLI sends only the message, the bound club, a fixed conversation context and optionally the
session ID; a user ID, roles, permissions or target people cannot be passed along. If the agent
writes something during the dialog, it automatically opens an approval request — the response
immediately names its direct link, in JSON mode in the `approval_refs` field; a typed "yes"
approves nothing, neither in the terminal nor in the web chat.

### Reading approvals

1. List open approvals: `comvenio agent approval list`.
2. Decided ones from the last 7 days: `comvenio agent approval list --state decided`.
3. Details of one approval: `comvenio agent approval show <id>`.
4. Print the direct link (this decides nothing): `comvenio agent approval approve <id>` or
   `comvenio agent approval reject <id>`.
5. The decision itself happens only through the printed link, in the web app or the mobile app —
   a typed "yes" approves nothing, neither in the terminal nor in the web chat. The service
   refuses a decision made through the CLI's device-token sign-in.

### Calling functions directly

Every released function can also be called without chat — with the same checks as the button in
the web app or the agent itself (input schema, permission, approval). Which functions exist and
what input they need is served by the service at runtime; a new function needs no new CLI for it.

1. See the released functions: `comvenio function list`.
2. Run a function: `comvenio function run <function> --args '{"…":"…"}'`.
3. Check the state of a run: `comvenio function show <run-id>`.
4. With `--idempotency-key <key>` a repeat is safe: the same key returns the same run instead of a
   second one.
5. If the function needs an approval, `run` prints its direct link; that decision is also made
   only in the web app or the mobile app.

### Availability

CLI and function access to the club agent does not carry its own surcharge; the central product
and club approvals apply regardless of channel — CLI or another channel does not bypass them. If
the club agent is not enabled for a particular channel, that only hides the club agent dialog on
that channel; direct club actions remain usable regardless.

### What the CLI does not manage yet

`agent chat` covers the conversational use, `agent approval` covers reading approvals. The
administrative club agent workflows — configuration, skill packages, routines, watch rules,
journal and memory — are not yet implemented as their own, secured CLI actions.

## Examples

```bash
comvenio agent chat "Plan the volunteer roster for our summer party."
comvenio agent chat "Saturday instead of Friday, please." --session <session-id>
comvenio agent approval list
comvenio agent approval list --state decided
comvenio agent approval show <id>
comvenio function list
comvenio function run task.create --args '{"title":"Send out the minutes"}'
comvenio function show <run-id>
```

## Commands and actions

<!-- gen:docs befehle -->

**agent** — core available, some workflows missing

- `comvenio agent chat`
- `comvenio agent approval`
- `comvenio function`
<!-- /gen:docs -->

## Errors

- `CLUB_AGENT_NOT_READY` — the club agent is not yet set up for the club. More:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — the sign-in is missing a scope needed for chat or a function. More:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow the function or the approval. More:
  `comvenio help fehler PERMISSION_DENIED`.
- `NOT_FOUND` — session, approval, function or run are not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `VALIDATION_FAILED` — `--args` does not match the function's input schema. More:
  `comvenio help fehler VALIDATION_FAILED`.
