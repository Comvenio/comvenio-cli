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

Sign in with `comvenio login`; which actions your club has enabled and which
scopes they need is shown by `comvenio action list --json`.

A valid sign-in is required for every further command. The sign-in only
decides *that* someone is signed in; *what* is allowed follows from the
requested scopes and additionally from the role in the club. Write steps on
the club profile or settings need the permission to manage club settings.

## Workflows

### Installing the CLI

The CLI is source-available and is built from the public repository; there
is no npm package. You need `git` and [Bun](https://bun.sh).

```bash
git clone https://github.com/Comvenio/comvenio-cli.git
cd comvenio-cli
bun install
bun run build
mkdir -p ~/.local/bin && mv comvenio ~/.local/bin/
comvenio help
```

`bun run build` creates a standalone file `comvenio` (`comvenio.exe` on
Windows) that runs without Bun; its folder must be on your search path
(`PATH`). To update: run `git pull` in the folder, repeat `bun install` and
`bun run build`, and replace the file. `comvenio --version` names the build
date and commit (for example `0.1.0+2026-09-29.abc1234`); if `comvenio help`
shows no list of topics, an outdated version is installed.

### Signing in

```bash
comvenio login
comvenio login --scopes club.read,event.read --json
comvenio login --scopes club.read,role.read.self,member.read.basic,team.read,event.read,task.read --json
```

`login` opens the system browser and signs in through an open,
PKCE-protected OAuth flow. Without `--scopes`, `login` requests all scopes;
what is actually allowed continues to be decided by the roles in the club.
`--scopes` deliberately restricts the sign-in, for example to read-only
access: read-only scopes end in `.read` (the third example above). Which
scopes an action needs is listed under "Commands and actions" in every topic.

All scopes: `public.read`, `club.read`, `club.write`, `member.read.basic`, `member.read.details`, `member.write`, `team.read`, `team.write`, `role.read.self`, `role.write`, `event.read`, `event.write`, `booking.read`, `booking.write`, `object.read`, `object.write`, `content.read`, `content.write`, `task.read`, `task.write`, `supply.read`, `supply.write`, `meeting.read`, `meeting.write`, `sponsor.read`, `sponsor.write`, `finance.read`, `finance.write`, `files.read`, `files.write`, `files.export`, `files.import`, `admin.write`, `connector.grants`.

Credentials are not stored in the open in the CLI state: on Windows the
operating system's credential store protects the entry for the current
user, on macOS the keychain, on Linux the respective secret service. The
file `~/.comvenio-cli-state.json` only contains non-secret details such as
environment, club, client id and scopes. Before storing, the club actually
bound to the sign-in is verified.

Options:

| Flag | Meaning |
|---|---|
| `--scopes <csv>` | restrict the sign-in to these scopes (without: all) |
| `--json` | machine-readable output |

The file `~/.comvenio-cli-state.json` must, as a matter of principle, never
be committed, logged or printed in a response.

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
cannot be overridden through the input — `club_id` therefore never belongs
in `--input`.

### Connecting an AI assistant (connector)

Claude, ChatGPT and other assistants with MCP support work with Comvenio
directly, without the CLI. In the assistant, add a custom connector
("Custom connector" or "Add connector") with the address
`https://mcp.comvenio.app/mcp`; the assistant then opens the Comvenio
sign-in in the browser, where you choose your club and confirm the requested
scopes. The connector uses the same actions, scopes and confirmations as the
CLI; club and rights come from this sign-in and your role in the club. The
customer help (`comvenio_hilfe`) is available there even without signing in.
To disconnect: remove the connector in the assistant.

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

`logout` revokes the sign-in on the server and then removes the local
credential entry. If the server-side revocation temporarily fails, a warning
is shown; the local sign-in is removed anyway.

### Reading club information

Not yet available as an action — do this in the web app. It shows name,
short name, address, email, phone, website and founding date of the club.

### Checking public club bodies and legal information

Not yet available as an action — do this in the web app. It shows released
club bodies with their positions and the club's public legal notice details.

### Changing club profile and settings

```bash
comvenio action call cai.club.03.settings --input '{}' --json
comvenio action call cai.club.02.update \
  --input '{"changes":{"name":"New club name"}}' \
  --json
comvenio action call cai.club.04.settings_update \
  --input '{"settings":{"notification_settings":{"notification_frequency":"weekly"}}}' \
  --json
```

`cai.club.02.update` submits a partial profile record in `changes`. Valid
fields include name, description, address, city, postal code, country,
state, phone number, email, website, founding date, social media addresses,
default language, default timezone and the responsible person.
`cai.club.04.settings_update` performs a field-by-field merge in `settings`
for these areas: `organization_type`, `design_settings`, `features`,
`homepage_config`, `privacy_settings`, `contact_info`, `seo_settings`,
`notification_settings` and `locale_settings`.

### Managing departments

```bash
comvenio action call cai.club.06.department_list --input '{}' --json
comvenio action call cai.club.06.department_list --input '{"tree":true}' --json
comvenio action call cai.club.07.department_show \
  --input '{"department_id":"<department-id>"}' \
  --json
comvenio action call cai.club.08.department_add \
  --input '{"department":{"name":"Dart","description":"Dart department","slug":"dart","color_theme_1":"#123456","parent_department_id":null,"is_default":false}}' \
  --json
comvenio action call cai.club.09.department_update \
  --input '{"department_id":"<department-id>","changes":{"name":"Dart"}}' \
  --json
```

When updating, the responsible person and a new parent department are also
allowed. The club is taken from the active sign-in context when creating.

Deleting is critical and runs through a preview and confirmation:

```bash
comvenio action call cai.club.10.department_delete \
  --input '{"department_id":"<department-id>"}' \
  --json
# the response contains preview_id and confirmation_token
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <token> \
  --idempotency-key <key>
```

### Setting the club design

`cai.club.05.design` merges the design settings in `design_settings`: fields
left out are kept. The full set of fields — colors, font, spacing, custom
CSS, header — is in the schema: `comvenio schema design --json`.

```bash
comvenio action call cai.club.05.design \
  --input '{"design_settings":{"homepage_theme":"modern","homepage_template":"flex","primary_color":"#123456","accent_color":"#e7b23c"}}' \
  --json
```

Before every design change, use the homepage preview and check afterward.
The complete workflow for the public page is in the club homepage article.

### Loading a public club logo

A club's logo is public. `club logo --slug` loads it without signing in, using the
slug of the club's public page, and saves it to a file; the output names club ID,
name and club colour. Only what the public club page shows anyway is read.

```bash
comvenio club logo --slug sv-motzing --out sv-motzing.png --json
```

Unknown slug or a club without a logo → stops with a message. `--env dev` reads the
test environment.

### Maintaining the club logo

Not yet available as an action — do this in the web app. The most recently
uploaded logo there takes effect immediately everywhere the platform shows
the club logo: homepage header, image widget with the club logo as source,
club selection.

## Examples

Sign in with restricted scopes, then check identity:

```bash
comvenio login --scopes club.read,event.read --json
comvenio whoami --json
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
comvenio action call cai.club.08.department_add \
  --input '{"department":{"name":"Dart","description":"Dart department","slug":"dart","color_theme_1":"#123456","parent_department_id":null,"is_default":false}}' \
  --json
```

## Commands and actions

<!-- gen:docs befehle -->

**login**

- No action yet — this area works through the web app.

**logout**

- No action yet — this area works through the web app.

**whoami**

- `cai.whoami.01.whoami` — whoami (read) · Scopes: `club.read`

**action**

- No action yet — this area works through the web app.

**club**

- `cai.club.02.update` — update (change) · Scopes: `admin.write`
- `cai.club.03.settings` — settings (read) · Scopes: `club.read`
- `cai.club.04.settings_update` — settings-update (change) · Scopes: `admin.write`
- `cai.club.05.design` — design (change) · Scopes: `admin.write`
- `cai.club.06.department_list` — department-list (read) · Scopes: `club.read`
- `cai.club.07.department_show` — department-show (read) · Scopes: `club.read`
- `cai.club.08.department_add` — department-add (change) · Scopes: `admin.write`
- `cai.club.09.department_update` — department-update (change) · Scopes: `admin.write`
- `cai.club.10.department_delete` — department-delete (change with confirmation) · Scopes: `admin.write`
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
- `VALIDATION_FAILED` — the input does not match the action's schema, for
  example a missing required field in `changes`, `settings` or
  `department`. `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — `action confirm` (for example on `department_delete`)
  ended with a timeout or server error; do not retry, check the current
  state first. `comvenio help fehler OUTCOME_UNKNOWN`.
- `OAUTH_ONLY` — an old command does not run with the current sign-in; use
  the matching action instead. `comvenio help fehler OAUTH_ONLY`.
- `CLUB_SELECTION_REQUIRED` — no club is assigned to the current connection.
  `comvenio help fehler CLUB_SELECTION_REQUIRED`.
- `ACTION_NOT_LISTED` — the action is currently not in the enabled list;
  right after a new release this can be temporary.
  `comvenio help fehler ACTION_NOT_LISTED`.
