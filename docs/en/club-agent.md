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
not an alternative data source and not a generic pass-through: every access runs with the identity
of the signed-in person, and the service checks club and rights again.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login` — the default sign-in covers all scopes, narrow it with `--scopes`.
What chat and functions may actually do additionally depends on the club role. If the club agent
is not yet set up for the club, an administrator of the club must do that in the web app first.
Approvals and standing approvals are created and ended only in the web app or the mobile app,
never in the terminal.

## Workflows

### Talking to the club agent

1. Send a message: `comvenio agent chat "<message>"`.
2. The response carries a session ID.
3. For follow-ups and corrections, reuse the same session:
   `comvenio agent chat "<message>" --session <session-id>`.

### Reading approvals

1. List open approvals: `comvenio agent approval list`.
2. Decided ones from the last 7 days: `comvenio agent approval list --state decided`.
3. Details of one approval: `comvenio agent approval show <id>`.
4. Print the direct link (this decides nothing): `comvenio agent approval approve <id>` or
   `comvenio agent approval reject <id>`.
5. The decision itself happens only through the printed link, in the web app or the mobile app —
   a typed "yes" in the terminal approves nothing.

### Calling functions directly

1. See the released functions: `comvenio function list`.
2. Run a function: `comvenio function run <function> --args '{"…":"…"}'`.
3. Check the state of a run: `comvenio function show <run-id>`.
4. With `--idempotency-key <key>` a repeat is safe: the same key returns the same run instead of a
   second one.
5. If the function needs an approval, `run` prints its direct link; that decision is also made
   only in the web app or the mobile app.

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
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**agent** — core available, some workflows missing

- `comvenio agent chat`
- `comvenio agent approval`
- `comvenio agent function`
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
