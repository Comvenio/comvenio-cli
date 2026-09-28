---
id: fehlerbilder
kategorie: uebersicht
domaenen: []
stichwoerter: [error, errors, error-codes, cause]
---

# comvenio CLI — symptom → cause → correct path

> The same stumbling blocks cost time again and again. Here they are listed
> by the message text actually seen.

## Ground rule: browser sign-in only

The path is `comvenio login` (browser, OAuth) followed by
`comvenio action list|call|confirm`. Older, classic commands do **not** run
under this sign-in — that is by design, not a bug: a development token is
the old path, the browser sign-in the only intended one. If a function is
missing as an action, it is reported through the issue form.

**The default sign-in requests all scopes.** What is actually allowed
continues to be decided by the roles in the club. Anyone who wants to
deliberately restrict access does so, for example to read-only:

```bash
comvenio login --scopes club.read,role.read.self
```

If an action reports `Error SCOPE_REQUIRED`, the sign-in usually predates
this default or was deliberately restricted: run the displayed
`comvenio login` command.

Which scopes an action needs is shown by `comvenio action list --json`
(security details per action). The scopes currently granted to the
connection are shown by `~/.comvenio-cli-state.json` (not secret).

## Anatomy of an error message

Every message starts with a stable code, states the cause in one sentence,
and gives the next command:

```text
Error SCOPE_REQUIRED: Your sign-in is missing a permission for this action. …
→ comvenio login --scopes admin.write,club.read,club.write
More: comvenio help fehler SCOPE_REQUIRED
Request id: …
```

`--json` returns the same as an object with code, message, cause, next
command, help reference, request id and language. The language is chosen
with `--lang de|en`, otherwise the system's language setting, otherwise
German. All codes with their texts are in
[fehler/katalog.json](fehler/katalog.json); each code also has its own
article under `fehler/` with meaning, typical causes and solution.

## Symptoms

| Message (excerpt) | Cause | Correct path |
|---|---|---|
| `Error OAUTH_ONLY` (formerly: "This classic command does not run through the OAuth sign-in") | A classic command under the browser sign-in. | `comvenio action list` → the matching action with `comvenio action call <id> --input '{…}'`. If none exists: report it as a wish through the issue form. |
| `Error SCOPE_REQUIRED` (formerly: "… not available in your current club and permission context.") | The sign-in is missing the named scope — for example a write scope for an action that requires confirmation. | Run the displayed `comvenio login --scopes …` command; it includes the previous and the missing scopes. |
| `Error PERMISSION_DENIED` | The scopes are correct, but the role in the club does not allow the action. | An administrator of the club grants the permission. |
| `Error ACTION_NOT_LISTED` | The action is not in this connection's tool list. Can also be temporary **right after a new release**. | Check `comvenio action list`; after a new release, wait a minute and retry. |
| "The service did not return an approved response shape." | The response does not match the action's published contract — an error on Comvenio's side, not yours. | Do not work around it; report it as a bug (issue form) with the action id and time. |
| `Error AUTH_REQUIRED` with the note that the connection no longer holds | The OAuth sign-in has expired or was revoked. | `comvenio login` (with the same `--scopes`). |
| Asked for a development token during login / value missing | Old path. | Do not use it; run `comvenio login` without a token. |
| `Error OUTCOME_UNKNOWN` | A write action (for example `action confirm`) ended with a timeout or server error — possibly after Comvenio had already carried it out. | **Do not retry**, or the entry may be created twice. Check the current state with the matching read action first. |
| `Error UNKNOWN_ERROR` | A case without a description. | Report it as a bug (issue form) with the request id and time. |
