---
id: finanzen
kategorie: thema
domaenen: [finance]
stichwoerter: [finance, accounting, annual plan, budget position, entry, cents]
---

# Club accounting

## Purpose

The finance commands cover the club's accounting: the annual plan, the budget positions under it
and the entries booked against those positions — so a club's income and expenses for a year can be
planned, recorded and reported on.

## Requirements and permissions

Sign in with `comvenio login`; the scopes a given command needs are shown by
`comvenio action list --json`. For agents, `--json` is the binding output form.

- `--club <club-id>` overrides the club from the local sign-in state.

> **Not to be confused with:** `comvenio booking` is room booking, `comvenio sponsor` is the local
> sponsor. Neither has anything to do with accounting.

## Workflows

### Managing the annual plan

1. List plans: `comvenio finance plan-list`.
2. View a single plan: `comvenio finance plan-show --year <year>`.
3. Create a plan: `comvenio finance plan-create --year <year> --capital <cents> --notes "<text>"`.
4. Update a plan: `comvenio finance plan-update --year <year> --capital <cents>`.
5. Close a year: `comvenio finance plan-close --year <year>`; add `--force` for open positions.
   After that, the service rejects changes to positions and entries — including reversing an
   automatic entry.
6. Reopen a closed year: `comvenio finance plan-reopen --year <year> --reason "<reason>"`.
   `--reason` is required (at least 3 characters).
7. Copy a plan into a new year: `comvenio finance plan-copy <source-year> --year <target-year>`.
   Recurring positions are carried over automatically; one-off ones only with
   `--include-non-recurring` or via a selection in `--positions`. Positions whose event does not
   exist in the target year are reported under `unlinked_positions` — those still need linking.

`--year <year>` is required for every `plan-*` command, for `position-list`/`position-create` and
for `summary` — there is no default. `[id]` means the position or entry ID depending on the
action, and for `plan-copy` it is the **source year**.

### Managing budget positions

1. List positions: `comvenio finance position-list --year <year>`, optionally filtered with
   `--department <department-id>`.
2. Create a position: `comvenio finance position-create --year <year> --name <name> --category <category> --expense <cents>`.
3. View a single position: `comvenio finance position-show <position-id>`.
4. Update a position: `comvenio finance position-update <position-id> --expense <cents>`.
5. Delete a position: `comvenio finance position-delete <position-id>`.
6. Adopt the purchasing estimate as the planned value:
   `comvenio finance position-import-shopping <position-id>`; without `--overwrite` an already
   set planned value stays as is, and the response states under `applied` and `reason` whether it
   was adopted.

For the rarer fields (`position_number`, `context_type`, `context_id`, `parent_position_id`,
`recurring`, prior-year values), use a JSON file: `--file <payload.json>`; individual options
override individual fields from the file.

### Viewing the summary

1. Per plan: `comvenio finance summary --year <year>`.
2. Per department (a different endpoint, not a filter):
   `comvenio finance summary --year <year> --department <department-id>`.

### Managing entries

1. List a position's entries: `comvenio finance entry-list <position-id>`, optionally filtered
   with `--source-type <source>` (entered by hand, from purchasing, from sponsoring).
2. Create an entry: `comvenio finance entry-create <position-id> --description "<text>" --expense <cents> --date <date>`
   or `--revenue <cents>` instead of `--expense`. An entry is income or expense — never both, never
   neither, and the amount is greater than zero; this is checked before the network call.
3. View a single entry: `comvenio finance entry-show <entry-id>`.
4. Update an entry: `comvenio finance entry-update <entry-id> --expense <cents>`.
5. Approve an entry: `comvenio finance entry-approve <entry-id>`, optionally with `--notes "<text>"`.
6. Delete an entry: `comvenio finance entry-delete <entry-id>`.

**Amounts are cents, always whole numbers.** €45.50 is `4550`. Writing `45.50` means euros — the
CLI rejects that instead of silently creating a 45-cent entry.

### What this does not (yet) cover

| Area | Status |
|---|---|
| Dashboard, cash report, tax report | exists, coming here later |
| Event finances, purchasing bridge, sponsoring deal | exists read-only, coming here later |
| Investment planning, funding sources, scenarios | exists, intentionally not planned here |
| Stripe: Connect, invoices, payouts, subscriptions | exists, intentionally not planned here |
| Membership fees, donations, club invoices, chart of accounts | not implemented yet — there is nothing to operate there |

## Examples

```bash
comvenio finance plan-create --year 2026 --capital 500000 --notes "2026 budget"
comvenio finance plan-close --year 2026 --force --notes "Year-end close"
comvenio finance plan-reopen --year 2026 --reason "Supplementary entry for hall rent"
comvenio finance plan-copy 2025 --year 2026 --include-non-recurring
comvenio finance position-create --year 2026 --name "Summer party" --category Events --expense 120000
comvenio finance entry-create <position-id> --description "Beverages" --expense 4550 --date 2026-07-01
comvenio finance entry-approve <entry-id> --notes "Receipt on file"
comvenio finance summary --year 2026 --department <department-id>
```

## Commands and actions

<!-- gen:docs befehle -->

**finance** — core available, some workflows missing

- `comvenio finance plan list|show|create|update|close|reopen|copy`
- `comvenio finance position list|create|show|update|delete|import-shopping`
- `comvenio finance summary (je Plan und je Abteilung)`
- `comvenio finance entry list|create|show|update|delete|approve`
<!-- /gen:docs -->

## Errors

- `CONFLICT` — the year is closed; the service rejects changes to positions and entries until it
  is reopened. More: `comvenio help fehler CONFLICT`.
- `VALIDATION_FAILED` — an amount is not in cents, an entry is neither income nor expense or both,
  or a required field is missing. More: `comvenio help fehler VALIDATION_FAILED`.
- `NOT_FOUND` — plan, position or entry are not known under the given identifier. More:
  `comvenio help fehler NOT_FOUND`.
- `PERMISSION_DENIED` — the club role does not allow the accounting action. More:
  `comvenio help fehler PERMISSION_DENIED`.

A backend error is not an empty result: the CLI returns it with a non-zero exit code.
