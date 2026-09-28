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

Sign in with `comvenio login`; which scopes a given action needs is shown by `comvenio action list --json`. Writing role actions require the server-side permission `manage_roles`. The club's protected default roles can be read but not changed — there is deliberately no forced workaround for that.

## Workflows

### Creating and maintaining a role

Role names are unique within a club after trimming outer whitespace and regardless of case. A name conflict returns a conflict error; existing duplicates are not merged automatically. A deleted role can be restored.

### Setting the permission matrix

1. Fetch the available permission keys and a role's current matrix.
2. Either change exactly one value directly, or apply a whole matrix file.
3. A matrix file is additive by default: only the given keys are changed. A full replacement explicitly sets every key that is not given to "not allowed".
4. Without explicit confirmation, the CLI only shows the full before/after diff and performs no write. With confirmation, it re-reads the same state within the same run and secures the write against concurrent changes in the meantime.

A matrix file is a JSON object with true/false values per permission key; alternatively, a wrapper with a `values` field is allowed.

### Assigning a role directly

An assignment accepts only a stable member ID and an explicit scope: either the whole club or a specific department. The club scope forbids a department reference, the department scope requires it; errors here are caught before the actual write. An assignment, a removal and an unlinking from a position are each soft deletes — restoring is its own, explicit step.

### Linking a role to a position

Linking to a position describes the business assignment: whoever holds that position automatically receives the linked role. Effective permissions that result from this carry the source "position" instead of "direct".

### Tracing effective permissions

A member's effective permissions are merged server-side: without a department reference, only club-level assignments count; with a department reference, assignments for exactly that department are added. For every role involved, the response shows the permission key, the result, the role, the scope, and whether the permission came directly or through a position.

### Security boundaries

- Protected default roles and their matrix cannot be changed.
- There is no public forced delete and no club-wide wipe actions.
- Deleting, removing and unlinking are soft deletes; restoring remains its own, explicit state each time.
- Critical changes return machine-readable target, current state, diff and risk.
- An assignment always uses the member ID, never a name or email address.
- Writing calls are never retried automatically.
- Every full matrix replacement requires a visible preview and explicit confirmation.

## Examples

```bash
comvenio role list --json
comvenio role show <role-id> --json
comvenio role create --name "Kassenwart" --description "Darf Vereinsfinanzen verwalten" --json
comvenio role update <role-id> --description "Aktualisierte Beschreibung" --json
comvenio role delete <role-id> --json
comvenio role restore <role-id> --json
```

```bash
comvenio role permission-defs --json
comvenio role permissions show --role-id <role-id> --json

comvenio role permission set \
  --role-id <role-id> \
  --permission-key manage_events \
  --allowed true \
  --json
```

Matrix file:

```json
{
  "manage_events": true,
  "manage_finances": false
}
```

```bash
comvenio role permissions apply --role-id <role-id> --file matrix.json --json
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --json
comvenio role permissions apply --role-id <role-id> --file matrix.json --replace --yes --json
```

```bash
comvenio role assign \
  --member-id <member-id> \
  --role-id <role-id> \
  --scope club \
  --json

comvenio role assign \
  --member-id <member-id> \
  --role-id <role-id> \
  --scope department \
  --department-id <department-id> \
  --json

comvenio role assignments --json
comvenio role assignments --member-id <member-id> --json
comvenio role assignments --role-id <role-id> --json
comvenio role assignments --department-id <department-id> --json
comvenio role unassign <assignment-id> --json
comvenio role assignment-restore <assignment-id> --json
```

```bash
comvenio role position-link \
  --position-id <position-id> \
  --role-id <role-id> \
  --department-id <department-id> \
  --json

comvenio role position-list --position-id <position-id> --json
comvenio role position-unlink <assignment-id> --json
comvenio role position-restore <assignment-id> --json
```

```bash
comvenio role effective --member-id <member-id> --json
comvenio role effective --member-id <member-id> --department-id <department-id> --json
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**role** — complete

- `comvenio role list`
- `comvenio role show`
- `comvenio role create`
- `comvenio role update`
- `comvenio role delete`
- `comvenio role permission-defs`
- `comvenio role permission set`
- `comvenio role permissions show|apply`
- `comvenio role assign`
- `comvenio role unassign`
- `comvenio role assignments`
- `comvenio role position-link`
- `comvenio role position-unlink`
- `comvenio role position-list`
- `comvenio role effective`
- Fields and values: `comvenio schema role --json`
<!-- /gen:docs -->

## Errors

- `CONFLICT` — the role name is already taken within the club, or a matrix was changed since the last preview. More: `comvenio help fehler CONFLICT`
- `VALIDATION_FAILED` — a scope does not match the department reference, or a field has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — the role, assignment or position link does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow managing roles. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for managing roles. More: `comvenio help fehler SCOPE_REQUIRED`
