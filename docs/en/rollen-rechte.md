---
id: rollen-rechte
kategorie: thema
domaenen: [role]
stichwoerter: [roles, permissions, rights, assignment, positions]
---

# Roles and permissions

## Purpose

With roles, a club creates its own roles with a permission matrix and assigns them to members either directly or through a position — and can trace at any time which permission a member has and where it comes from.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by `comvenio action list --json`. Writing role actions require the server-side permission `manage_roles`. The club's protected default roles can be read but not changed — there is deliberately no forced workaround for that.

## Workflows

### Creating and maintaining a role

`cai.role.03.create` creates a role with `name` and `description`. Role names are unique within a club after trimming outer whitespace and regardless of case; a name conflict returns a conflict error, existing duplicates are not merged automatically. `cai.role.04.update` changes `name` and/or `description` (at least one field). `cai.role.05.delete` is `critical_write`. Restoring a deleted role: not yet available as an action — do this in the web app.

### Setting the permission matrix

1. `cai.role.06.permission_defs` returns the available permission keys; `cai.role.08.permissions_show_apply` with `operation: show` returns a role's current matrix.
2. `cai.role.07.permission_set` changes exactly one value directly (`permission_key`, `allowed`) — `reversible_write`.
3. `cai.role.08.permissions_show_apply` with `operation: apply` applies a whole matrix (`values`); without `replace` this is additive, only the given keys are changed, with `replace: true` it explicitly sets every key that is not given to "not allowed". Both variants of this action are `critical_write` per the enabled action list: the call first returns only a preview with `preview_id` and `confirmation_token`; only `comvenio action confirm --preview-id <id> --confirmation-token <token> --idempotency-key <key>` with these values carries out the change and secures it against concurrent changes in the meantime.

### Assigning a role directly (`cai.role.09.assign`)

An assignment accepts only a stable member ID (`member_id`) and an explicit scope (`scope`): `club` or `department`. The club scope forbids a department reference, the department scope requires `department_id`; errors here are caught before the actual write. `cai.role.10.unassign` is `critical_write`. Restoring a removed assignment: not yet available as an action — do this in the web app.

### Linking a role to a position

`cai.role.12.position_link` describes the business assignment: whoever holds that position automatically receives the linked role. `cai.role.14.position_list` lists a position's links. `cai.role.13.position_unlink` is `critical_write`. Restoring an unlinked position: not yet available as an action — do this in the web app.

### Tracing effective permissions

Not yet available as an action — do this in the web app.

### Security boundaries

- Protected default roles and their matrix cannot be changed.
- There is no public forced delete and no club-wide wipe actions.
- An assignment always uses the member ID, never a name or email address.
- Writing calls are never retried automatically.
- Critical actions return machine-readable target, current state, diff, risk and a preview id; only `action confirm` with this id and a stable `--idempotency-key` carries out the change.

## Examples

```bash
comvenio action call cai.role.01.list --input '{}'
comvenio action call cai.role.02.show --input '{"role_id":"<role-id>"}'
comvenio action call cai.role.03.create --input '{"role":{"name":"Kassenwart","description":"Darf Vereinsfinanzen verwalten"}}'
comvenio action call cai.role.04.update --input '{"role_id":"<role-id>","changes":{"description":"Aktualisierte Beschreibung"}}'
comvenio action call cai.role.05.delete --input '{"role_id":"<role-id>"}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.role.06.permission_defs --input '{}'
comvenio action call cai.role.08.permissions_show_apply --input '{"operation":"show","role_id":"<role-id>"}'

comvenio action call cai.role.07.permission_set --input '{"role_id":"<role-id>","permission_key":"manage_events","allowed":true}'
```

Matrix as input:

```bash
comvenio action call cai.role.08.permissions_show_apply --input '{
  "operation": "apply",
  "role_id": "<role-id>",
  "values": [
    { "permission_key": "manage_events", "allowed": true },
    { "permission_key": "manage_finances", "allowed": false }
  ],
  "replace": false
}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <confirmation-token> \
  --idempotency-key <idempotency-key>
```

```bash
comvenio action call cai.role.09.assign --input '{"member_id":"<member-id>","role_id":"<role-id>","scope":"club"}'

comvenio action call cai.role.09.assign --input '{
  "member_id": "<member-id>",
  "role_id": "<role-id>",
  "scope": "department",
  "department_id": "<department-id>"
}'

comvenio action call cai.role.11.assignments --input '{"selector":{"type":"club"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"member","member_id":"<member-id>"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"role","role_id":"<role-id>"}}'
comvenio action call cai.role.11.assignments --input '{"selector":{"type":"department","department_id":"<department-id>"}}'
comvenio action call cai.role.10.unassign --input '{"assignment_id":"<assignment-id>"}'
```

```bash
comvenio action call cai.role.12.position_link --input '{
  "position_id": "<position-id>",
  "role_id": "<role-id>",
  "department_id": "<department-id>"
}'

comvenio action call cai.role.14.position_list --input '{"position_id":"<position-id>"}'
comvenio action call cai.role.13.position_unlink --input '{"assignment_id":"<assignment-id>"}'
```

## Commands and actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Errors

- `CONFLICT` — the role name is already taken within the club, or a matrix was changed since the last preview. More: `comvenio help fehler CONFLICT`
- `VALIDATION_FAILED` — a scope does not match the department reference, or a field has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the role, assignment or position link does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow managing roles. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for managing roles. More: `comvenio help fehler SCOPE_REQUIRED`
- `OUTCOME_UNKNOWN` — for a write action, the server response was missing; before retrying, use a read action to check whether the change already landed. More: `comvenio help fehler OUTCOME_UNKNOWN`
