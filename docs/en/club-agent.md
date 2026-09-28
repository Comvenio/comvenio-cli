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
ChatGPT) and through the web app; the mobile app, voice and further channels are surfaces on top
of the same assistant. It is not an alternative data source and not a generic pass-through: every
access runs with the identity of the signed-in person, and the service checks club and rights
again.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is
shown by `comvenio action list --json`. What the club agent may do in a dialog or as a directly
called function additionally depends on the club role. If the club agent is not yet set up for the
club, an administrator of the club must do that in the web app first; in that case the service
responds without internal diagnostic or trace data. Approvals and standing approvals are created
and ended only in the web app or the mobile app, never in the terminal — standing approvals in the
"Capabilities & Routines" tab.

## Workflows

### Working with the club agent

The club agent has no CLI action of its own. It is addressed through the connected AI assistant —
the same dialog as in the web chat: direct data and action requests return structured,
deterministic club data and are preferable for simple questions about events, news, tasks, members
or other single areas; the agent itself additionally handles advice, planning, proactive hints and
multi-step tasks. The assistant only sees what the sign-in, the club and the club role allow. If
the agent writes something during the dialog, it automatically opens an approval request — a typed
"yes" approves nothing, neither in the assistant chat nor in the web chat.

### Approvals and administration

Open and decided approvals, standing approvals, configuration, skill packages, routines, watch
rules, journal and memory are handled only in the web app or the mobile app — approvals through
the direct link named in the dialog, standing approvals in the "Capabilities & Routines" tab.

### Availability

Access to the club agent through an AI assistant carries no surcharge of its own; the central
product and club approvals apply regardless of channel. If the club agent is not enabled for a
particular channel, that only hides the club agent dialog on that channel; the enabled actions of
the other topics remain usable regardless.

## Examples

The club agent itself has no `comvenio` commands. Which actions the assistant can use in the
dialog is shown by the sign-in:

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

- `CLUB_AGENT_NOT_READY` — the club agent is not yet set up for the club. More:
  `comvenio help fehler CLUB_AGENT_NOT_READY`.
- `SCOPE_REQUIRED` — the sign-in is missing a scope needed for the dialog or an action. More:
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the club role does not allow the dialog or the action. More:
  `comvenio help fehler PERMISSION_DENIED`.
