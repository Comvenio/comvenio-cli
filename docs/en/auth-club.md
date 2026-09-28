---
id: auth-club
kategorie: thema
domaenen: [login, logout, whoami, action, club]
stichwoerter: [login, sign-in, club, scopes, permissions]
---

# Sign-in and club context

## Purpose

Before any work with the CLI, a sign-in is established and the club context
is checked. This article covers signing in, signing out, checking identity,
the available actions, and reading and changing the club profile, settings,
departments and design.

## Requirements and permissions

> **Sign-in:** The `club` commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

A valid sign-in is required for every further command. The sign-in only
decides *that* someone is signed in; *what* is allowed follows from the
requested scopes and additionally from the role in the club. Write steps on
the club profile or settings need the permission to manage club settings.

## Workflows

### Signing in

```bash
comvenio login
comvenio login --scopes club.read,event.read --json
```

`login` opens the system browser and signs in through an open,
PKCE-protected OAuth flow. Without `--scopes`, `login` requests all scopes;
what is actually allowed continues to be decided by the roles in the club.
`--scopes` deliberately restricts the sign-in, for example to read-only
access.

Credentials are not stored in the open in the CLI state: on Windows the
operating system's credential store protects the entry for the current
user, on macOS the keychain, on Linux the respective secret service. The
file `~/.comvenio-cli-state.json` only contains non-secret details such as
environment, club, client id and scopes. Before storing, the club actually
bound to the sign-in is verified.

Options:

| Flag | Meaning |
|---|---|
| `--device-token <token>` | sign in with a device token instead of the browser; needed for the classic commands |
| `--scopes <csv>` | restrict the sign-in to these scopes (without: all) |
| `--club <id>` | only with `--device-token`: set the club context explicitly |
| `--json` | machine-readable output |

A device-token sign-in stores the opaque token in the state — the file `~/.comvenio-cli-state.json` must therefore never be committed,
logged or printed in a response, as a matter of principle.

### Working with actions

```bash
comvenio action list --json
comvenio action call cai.event.01.list \
  --input '{"range":{"from":"2026-07-24","to":"2026-08-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}' \
  --json
```

`action list` only returns actions that are actually visible for the current
sign-in, club, scopes and current permissions. Action id and input schema
come from the server-side contract of the respective action. Write actions
receive replay protection; critical changes additionally require
`action confirm` with a short-lived preview. Club, user identity and scopes
cannot be overridden through the input.

### Checking identity

```bash
comvenio whoami --json
```

The output includes, among other fields, user id, email, name, club id and
environment. During a brief outage of identity verification, `whoami` may
show cached identity fields; an expired or missing sign-in is still reported
correctly regardless.

### Signing out

```bash
comvenio logout --json
```

With a browser sign-in, `logout` revokes the sign-in on the server and then
removes the local credential entry. If the server-side revocation
temporarily fails, a warning is shown; the local sign-in is removed anyway.
A device token is not revoked on the server.

### Reading club information

```bash
comvenio club info --json
comvenio club info --club <club-id> --json
```

The human-readable view shows name, short name, address, email, phone,
website and founding date where available; for automated work the
machine-readable output is authoritative.

### Checking public club bodies and legal information

```bash
comvenio club group-list --json
comvenio club position-list --json
comvenio club public-organ <group-id> --json
comvenio club public-organ <group-id> --avatars --json
comvenio club public-legal --json
```

This lookup only returns explicitly released bodies of active clubs. Default
positions are excluded; members without another current position do not
appear. The response contains names and position descriptions, but no
private contact details. Public profile pictures are only requested with
`--avatars`; missing pictures are allowed. The release of a body is managed
separately — these read commands do not change it. `public-legal` checks the
public club details including the resolved responsible party; missing
details are never replaced with invented data.

### Changing club profile and settings

```bash
comvenio club update --file club-update.json --json
comvenio club settings --json
comvenio club settings-update --file settings-update.json --json
```

`club update` submits a partial profile record. Valid fields include name,
description, address, city, postal code, country, state, phone number,
email, website, founding date, social media addresses, default language,
default timezone and the responsible person. `settings-update` performs a
field-by-field merge for areas such as features, privacy settings, contact
details, search settings, notification settings, locale settings, payment
settings and custom settings.

### Managing departments

```bash
comvenio club department-list --json
comvenio club department-list --tree --json
comvenio club department-show <department-id> --json
comvenio club department-add --file department.json --json
comvenio club department-update <department-id> --file department-update.json --json
comvenio club department-delete <department-id> --json
```

Example `department.json`:

```json
{
  "name": "Dart",
  "description": "Dart department",
  "slug": "dart",
  "color_theme_1": "#123456",
  "parent_department_id": null,
  "is_default": false
}
```

When updating, the responsible person and a new parent department are also
allowed. The club is taken from the active sign-in context when creating,
not from the file.

### Setting the club design

`club design` merges the design settings: fields left out are kept.

```bash
comvenio club design \
  --template modern \
  --public-template flex \
  --primary "#123456" \
  --accent "#e7b23c" \
  --font modern \
  --spacing balanced \
  --dry-run --json

comvenio club design --file design-settings.json --json
```

| Flag | Effect |
|---|---|
| `--template <name>` | internal club-area theme |
| `--public-template <id>` | template of the public homepage |
| `--primary`, `--accent`, `--secondary` | brand colors as a hex value |
| `--font <pair>` | allowed font pairing |
| `--spacing <mode>` | spacing mode |
| `--file <json>` | full partial design object |
| `--css-file <css>` | scoped custom CSS |
| `--tokens-file <json>` | design tokens such as palette, radius and typography |
| `--header-layout`, `--header-surface`, `--header-density` | public header |
| `--header-sticky <true\|false>` | sticky behavior of the header |
| `--clear-header` | remove a custom header configuration |
| `--dry-run` | show the payload, write nothing |

Before every design change, run `--dry-run --json` first, then use the
homepage preview and check. The complete workflow for the public page is in
the club homepage article.

### Maintaining the club logo

```bash
comvenio club logo --json                          # current logo (metadata)
comvenio club logo-upload --file crest.png --json   # upload a new logo
```

The most recently uploaded logo takes effect immediately everywhere the
platform shows the club logo: homepage header, image widget with the club
logo as source, club selection. An image with a transparent background works
best on colored surfaces. A regular file upload does **not** replace the
logo — the logo selection only considers files uploaded through
`logo-upload`.

## Examples

Sign in with restricted scopes, then check identity and club:

```bash
comvenio login --scopes club.read,event.read --json
comvenio whoami --json
comvenio club info --json
```

Call an existing action with input:

```bash
comvenio action list --json
comvenio action call cai.event.01.list \
  --input '{"range":{"from":"2026-07-24","to":"2026-08-01","timezone":"Europe/Berlin","from_inclusive":true,"to_exclusive":true}}' \
  --json
```

Create a new department:

```bash
comvenio club department-add --file department.json --json
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**login** — complete

- `comvenio login`
- `comvenio login --device-token`

**logout** — complete

- `comvenio logout`

**whoami** — complete

- `comvenio whoami`

**action** — complete

- `comvenio action list`
- `comvenio action call`
- `comvenio action confirm`

**club** — complete

- `comvenio club info`
- `comvenio club update`
- `comvenio club settings`
- `comvenio club settings-update`
- `comvenio club design`
- `comvenio club logo`
- `comvenio club logo-upload`
- `comvenio club contact-requests`
- `comvenio club contact-request-done`
- `comvenio club contact-request-reopen`
- `comvenio club contact-request-delete`
- `comvenio club department-list`
- `comvenio club department-show`
- `comvenio club department-add`
- `comvenio club department-update`
- `comvenio club department-delete`
<!-- /gen:docs -->

## Errors

- `AUTH_REQUIRED` — the sign-in has expired, was revoked, or is missing.
  `comvenio help fehler AUTH_REQUIRED`.
- `SCOPE_REQUIRED` — the requested sign-in is missing the scope for this
  action; the next command shows the matching sign-in to repeat.
  `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the scopes match, but the club role does not allow
  the action; an administrator of the club grants this permission.
  `comvenio help fehler PERMISSION_DENIED`.
- `OAUTH_ONLY` — a classic command does not run with the current sign-in; use
  the matching action instead. `comvenio help fehler OAUTH_ONLY`.
- `CLUB_SELECTION_REQUIRED` — no club is assigned to the current connection.
  `comvenio help fehler CLUB_SELECTION_REQUIRED`.
- `ACTION_NOT_LISTED` — the action is currently not in the enabled list;
  right after a new release this can be temporary.
  `comvenio help fehler ACTION_NOT_LISTED`.
