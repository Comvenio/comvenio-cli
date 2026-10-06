---
id: club-agent
kategorie: thema
domaenen: [agent]
stichwoerter: [club agent, chat, functions, approval, approvals, session, standing approval]
---

# Club agent

## Purpose

The club agent is Comvenio's own, channel-independent assistant for advice, planning and
multi-step tasks in the club — for example planning a volunteer roster or creating a task. It is
reachable through an AI assistant connected via the Comvenio connector (for example in Claude or
ChatGPT), from the terminal with `comvenio agent chat` and through the web app; the mobile app,
voice and further channels are surfaces on top of the same assistant. It is not an alternative data source and not a generic pass-through: every
access runs with the identity of the signed-in person, and the service checks club and rights
again.

## Requirements and permissions

Sign in with `comvenio login`; `comvenio agent chat` needs the scope `club.read`, which every
sign-in without `--scopes` includes. Which actions your club has enabled and which scopes they need
is shown by `comvenio action list --json`. What the club agent may do in a dialog additionally
depends on the club role. If the club agent is not yet set up for the
club, an administrator of the club must do that in the web app first; in that case the service
responds without internal diagnostic or trace data. Approvals and standing approvals are created
and ended only in the web app or the mobile app, never in the terminal — standing approvals in the
"Capabilities & Routines" tab.

## Workflows

### Working with the club agent

From the terminal you talk to the club agent with `comvenio agent chat "<message>"`; the club
comes from your sign-in. Without `--session` a new conversation starts, with `--session <id>` you
continue the previous one — every answer names its session. If `--session` names none of your
conversations, the club agent starts a new one and the command tells you so. For every approval
the turn created or touched, the answer shows one line with the approval link, and for every run
one line with its state; with `--json` the same comes as an object with `session_id`, `response`,
`run_refs` and `approval_refs`. A local AI agent reads the approval links from `approval_refs` and
passes them on to you — it never approves anything itself.

Through a connected AI assistant the dialog is the same as in the web chat: direct data and action requests return structured,
deterministic club data and are preferable for simple questions about events, news, tasks, members
or other single areas; the agent itself additionally handles advice, planning, proactive hints and
multi-step tasks. The assistant only sees what the sign-in, the club and the club role allow. If
the agent writes something during the dialog, it automatically opens an approval request — a typed
"yes" approves nothing, neither in the assistant chat nor in the terminal nor in the web chat.

### Approvals and administration

Open and decided approvals, standing approvals, functions, configuration, skill packages,
routines, watch rules, journal and memory are handled only in the web app or the mobile app —
approvals through the direct link named in the dialog or under "My agent", lane "Needs you";
functions and standing approvals in the admin tab "Capabilities & Routines". The former commands
`comvenio agent approval`, `comvenio function` and `comvenio automation` no longer exist in the
CLI; a call ends with `USAGE_ERROR` and names the place.

Automations run through the actions `cai.club.16.automation_list` to
`cai.club.25.automation_delete` (list, options, show, runs, create, update, pause, resume, run now,
delete) with `comvenio action call`, or in the web app under "Automations". Reading needs
`club.read`, writing `club.write`; create, update, run now and delete show a preview first and run
after `comvenio action confirm`. The service checks the rights as in the web app: club-wide
automations only with the management right in the area, personal ones only your own. Approvals of
a run stay in the web or mobile app.

### Availability

Access to the club agent through an AI assistant carries no surcharge of its own; the central
product and club approvals apply regardless of channel. If the club agent is not enabled for a
particular channel, that only hides the club agent dialog on that channel; the enabled actions of
the other topics remain usable regardless.

## Examples

Start a new conversation and continue it:

```bash
comvenio agent chat "What is coming up in the club this week?"
comvenio agent chat "And at the weekend?" --session <session-id>
```

Machine-readable for local AI agents — approval links are in `approval_refs`:

```bash
comvenio agent chat "Create the weekly preview for the football department." --json
```

```json
{
  "session_id": "<session-id>",
  "response": "The weekly preview has been created and is waiting for your approval.",
  "run_refs": [{ "run_id": "<run-id>", "kind": "command_run", "state": "awaiting_approval" }],
  "approval_refs": [{ "approval_id": "<approval-id>", "state": "open", "approval_url": "<approval-link>" }]
}
```

Which actions the assistant can use in the dialog is shown by the sign-in:

```bash
comvenio action list --json
```

Full call examples for the individual actions are in the relevant topic articles (for example
tasks, events, members).

## Commands and actions

<!-- gen:docs befehle -->

**agent**

- No action yet — this area works through the web app.
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — no valid sign-in; run `comvenio login`. More:
  `comvenio help fehler AUTH_REQUIRED`.
- `CLUB_AGENT_NOT_READY` — the club agent is not yet set up for the club. More:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — the sign-in is missing a scope needed for the dialog or an action. More:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow the dialog or the action. More:
  `comvenio help fehler PERMISSION_DENIED`.
- `UPSTREAM_TIMEOUT` — the club agent did not answer in time; the message may have arrived anyway.
  More: `comvenio help fehler UPSTREAM_TIMEOUT`.
- `USAGE_ERROR` — for example a call of `comvenio function`, `comvenio automation` or
  `comvenio agent approval`; the message names the place in the web app. More:
  `comvenio help fehler USAGE_ERROR`.
