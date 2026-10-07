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
under this sign-in — that is by design, not a bug: the intended way is
exclusively the browser sign-in with actions. If a function is missing as an
action, it is reported through the issue form.

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
connection are shown by `~/.comvenio-cli-state.json` → field `connector.scopes` (not secret).

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
| `Error USAGE_ERROR` with "… gibt es im CLI nicht mehr." (formerly: `Error OAUTH_ONLY`) | A classic command the CLI no longer has. | `comvenio action list` → the matching action with `comvenio action call <id> --input '{…}'`. If none exists: report it as a wish through the issue form. |
| `Error SCOPE_REQUIRED` (formerly: "… not available in your current club and permission context.") | The sign-in is missing the named scope — for example a write scope for an action that requires confirmation. | Run the displayed `comvenio login --scopes …` command; it includes the previous and the missing scopes. |
| `Error PERMISSION_DENIED` | The scopes are correct, but the role in the club does not allow the action. | An administrator of the club grants the permission. |
| `Error ACTION_NOT_LISTED` | The action is not in this connection's tool list. Can also be temporary **right after a new release**. | Check `comvenio action list`; after a new release, wait a minute and retry. |
| "The service did not return an approved response shape." | The response does not match the action's published contract — an error on Comvenio's side, not yours. | Do not work around it; report it as a bug (issue form) with the action id and time. |
| `Error AUTH_REQUIRED` with the note that the connection no longer holds | The OAuth sign-in has expired or was revoked. | `comvenio login` (with the same `--scopes`). |
| Asked for a token during login / value missing | Not needed. | Run `comvenio login` without a token. |
| `--club is not allowed with OAuth` | `--club` was given to `comvenio login` — a usage error, not an expired sign-in. | Run `comvenio login` without `--club`; the club is chosen in the Comvenio consent screen and bound server-side. |
| `Error OUTCOME_UNKNOWN` | A write action (for example `action confirm`) ended with a timeout (15-second limit) or server error — possibly after Comvenio had already carried it out. | **Do not retry**, or the entry may be created twice. Check the current state with the matching read action first. |
| `Error UPLOAD_NOT_ENABLED` | `action call cai.data.06.upload --file …`: uploading from your own computer is not yet enabled for this club or on this server. | Upload the file in the web app; try again later. |
| `Error UPLOAD_REJECTED` | The check (size, checksum, file type, virus scan) rejected the file; the addition names the reason, for example `MALWARE` or `MIME_MISMATCH`. | Check the file against the reason, then upload it again. |
| `Error UPLOAD_TIMEOUT` | The upload was interrupted (Ctrl+C, connection) or not transferred and checked within 15 minutes — it has expired. | Start the same command again. |
| `Error TENANT_MISMATCH` on `cai.community.06.club_page` | `publish` onto a tab that is not a page of the signed-in club in this community (a general page or another club's page), or another club's `club_id` in the input. Nothing was written. | Read the own pages with `cai.community.06.club_page show` and take their `tab_id`; for another club sign in with that club (`comvenio login`). |
| `Error COMMUNITY_NOT_IN_CLUB` | A `cai.community.*` action for a community whose member clubs do not include the club of the sign-in. Nothing else was read or written. | Sign in with a club that is a member of the community (`comvenio login`, choose the club in the consent). |
| `Error CONFLICT` with `TAB_VERSION_CONFLICT: …` and "(Tabs: …)" | `cai.community.03.apply`: one of the named pages changed or was removed after the preview, or `expected_versions` are missing. Nothing of the page was written. | Preview again (`cai.community.02.preview`), approve again and apply with the `expected_versions` of that response — never freshly read versions. |
| `Error CONFLICT` with `DESIGN_VERSION_CONFLICT: …` | `cai.community.05.design update` with an outdated `expected_design_version`. | Read the design again with `cai.community.05.design show` and set it with the new `design_version`. |
| `Error UNKNOWN_ERROR` | A case without a description. | Report it as a bug (issue form) with the request id and time. |
