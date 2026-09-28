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

Sign in with `comvenio login`; which actions your club has enabled and which scopes they need is
shown by `comvenio action list --json`. For agents, `--json` is the binding output form.

- `--club <club-id>` overrides the club from the local sign-in state.

> **Not to be confused with:** `comvenio booking` is room booking, `comvenio sponsor` is the local
> sponsor. Neither has anything to do with accounting.

## Workflows

### Managing the annual plan

1. List plans: `comvenio finance plan-list` (action: `cai.finance.01.plan_list`).
2. View a single plan: `comvenio finance plan-show --year <year>` (action:
   `cai.finance.02.plan_show`).
3. Create a plan: `comvenio finance plan-create --year <year> --capital <cents> --notes "<text>"`
   (action: `cai.finance.03.plan_create`).
4. Update a plan: `comvenio finance plan-update --year <year> --capital <cents>` (action:
   `cai.finance.04.plan_update`).
5. Close a year: `comvenio finance plan-close --year <year>` (action:
   `cai.finance.05.plan_close`); add `--force` for open positions. After that, the service rejects
   changes to positions and entries — including reversing an automatic entry.
6. Reopen a closed year: `comvenio finance plan-reopen --year <year> --reason "<reason>"`.
   `--reason` is required (at least 3 characters); this step has no action yet.
7. Copy a plan into a new year: `comvenio finance plan-copy <source-year> --year <target-year>`
   (action: `cai.finance.07.plan_copy`). Recurring positions are carried over automatically;
   one-off ones only with `--include-non-recurring` or via a selection in `--positions`. Positions
   whose event does not exist in the target year are reported under `unlinked_positions` — those
   still need linking.

`--year <year>` is required for every `plan-*` command, for `position-list`/`position-create` and
for `summary` — there is no default. `[id]` means the position or entry ID depending on the
action, and for `plan-copy` it is the **source year**.

### Managing budget positions

1. List positions: `comvenio finance position-list --year <year>`, optionally filtered with
   `--department <department-id>` (action: `cai.finance.08.position_list`).
2. Create a position: `comvenio finance position-create --year <year> --name <name> --category
   <category> --expense <cents>` (action: `cai.finance.09.position_create`).
3. View a single position: `comvenio finance position-show <position-id>` (action:
   `cai.finance.10.position_show`).
4. Update a position: `comvenio finance position-update <position-id> --expense <cents>` (action:
   `cai.finance.11.position_update`).
5. Delete a position: `comvenio finance position-delete <position-id>` (action:
   `cai.finance.12.position_delete`).
6. Adopt the purchasing estimate as the planned value: `comvenio finance position-import-shopping
   <position-id>` (action: `cai.finance.13.position_import_shopping`); without `--overwrite` an
   already set planned value stays as is, and the response states under `applied` and `reason`
   whether it was adopted.

For the rarer fields (`position_number`, `context_type`, `context_id`, `parent_position_id`,
`recurring`, prior-year values), use a JSON file: `--file <payload.json>`; individual options
override individual fields from the file.

### Viewing the summary

1. Per plan: `comvenio finance summary --year <year>` (action: `cai.finance.14.summary`,
   sub-operation `total`).
2. Per department (a different endpoint, not a filter): `comvenio finance summary --year <year>
   --department <department-id>` (sub-operation `by_department`).

### Managing entries

1. List a position's entries: `comvenio finance entry-list <position-id>`, optionally filtered
   with `--source-type <source>` (entered by hand, from purchasing, from sponsoring) (action:
   `cai.finance.15.entry_list`).
2. Create an entry: `comvenio finance entry-create <position-id> --description "<text>" --expense
   <cents> --date <date>` or `--revenue <cents>` instead of `--expense` (action:
   `cai.finance.16.entry_create`). An entry is income or expense — never both, never neither, and
   the amount is greater than zero; this is checked before the network call.
3. View a single entry: `comvenio finance entry-show <entry-id>` (action:
   `cai.finance.17.entry_show`).
4. Update an entry: `comvenio finance entry-update <entry-id> --expense <cents>` (action:
   `cai.finance.18.entry_update`).
5. Approve an entry: `comvenio finance entry-approve <entry-id>`, optionally with `--notes
   "<text>"` (action: `cai.finance.20.entry_approve`).
6. Delete an entry: `comvenio finance entry-delete <entry-id>` (action:
   `cai.finance.19.entry_delete`).

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

**finance**

- `cai.finance.01.plan_list` — list (read) · Scopes: `finance.read`
- `cai.finance.02.plan_show` — show (read) · Scopes: `finance.read`
- `cai.finance.03.plan_create` — create (change) · Scopes: `finance.write`
- `cai.finance.04.plan_update` — update (change) · Scopes: `finance.write`
- `cai.finance.05.plan_close` — close (change with confirmation) · Scopes: `finance.write`
- `cai.finance.07.plan_copy` — copy (change with confirmation) · Scopes: `finance.write`
- `cai.finance.08.position_list` — list (read) · Scopes: `finance.read`
- `cai.finance.09.position_create` — create (change) · Scopes: `finance.write`
- `cai.finance.10.position_show` — show (read) · Scopes: `finance.read`
- `cai.finance.11.position_update` — update (change) · Scopes: `finance.write`
- `cai.finance.12.position_delete` — delete (change with confirmation) · Scopes: `finance.write`
- `cai.finance.13.position_import_shopping` — import (change) · Scopes: `finance.write`
- `cai.finance.14.summary` — total, by_department (read) · Scopes: `finance.read`
- `cai.finance.15.entry_list` — list (read) · Scopes: `finance.read`
- `cai.finance.16.entry_create` — create (change) · Scopes: `finance.write`
- `cai.finance.17.entry_show` — show (read) · Scopes: `finance.read`
- `cai.finance.18.entry_update` — update (change with confirmation) · Scopes: `finance.write`
- `cai.finance.19.entry_delete` — delete (change with confirmation) · Scopes: `finance.write`
- `cai.finance.20.entry_approve` — approve (change with confirmation) · Scopes: `finance.write`
- `cai.finance.21.plan_period` — list, create, show, update, positions, position_create, summary, journal, entries_without_receipt, sphere_report, audit_check, audit_labels, audit_label_set, dashboard (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.22.plan_lifecycle` — close, next_period (change with confirmation) · Scopes: `finance.write`
- `cai.finance.23.settings` — show, update (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.24.money_account` — list, create, update, opening, opening_versions, cash_book, reconciliation, grants, grant_set, grant_revoke, transfers, transfer_show, transfer_create, transfer_reverse, booking_accounts (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.25.entry_correction` — entry_create, entry_create_unplanned, reverse, receipt, versions, receipt_scan_create, receipt_candidates, receipt_attach, receipt_book, receipt_reject, receipt_event_set, receipt_withdraw, receipt_file, position_link_set, position_link_remove, tax_sphere, objection_create, objections, objection_withdraw (change, change with confirmation, read) · Scopes: `finance.write`, `finance.read`
- `cai.finance.26.cash_report` — list, create, show, submit, reject, entries, approve_entries, approve, tax_report (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.27.department_transfer` — list, account_choices, show, create, confirm, reject, withdraw, reverse (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.28.plan_result` — result, open_items, open_item_create, open_item_update, open_item_delete, resolutions, resolution_create, resolution_update, resolution_delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.29.procedure_doc` — show, version, save (read, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.30.audit_export` — list, create, download (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.31.finance_views` — receipt_inbox, receipt_scan, event, event_reconciliation, series_comparison, department_history, link_options, event_links, event_link_view, location_links, analysis_ranking, analysis_target, object (read) · Scopes: `finance.read`
- `cai.finance.32.investment_plan` — list, create, show, update, delete, dashboard, feasibility, funding_summary, loan_details (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.33.investment_item` — list, create, update, delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.34.investment_funding` — list, create, update, delete, loan_show, loan_create, loan_update (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.35.investment_scenario` — list, create, from_template, show, update, delete, auto_generate, cashflow_list, cashflow_create, cashflow_update, cashflow_delete (read, change, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.36.budget_organigram` — tree, frame_set, frame_versions, statement, rubrics, rubric_create, rubric_update, rubric_delete, position_split (read, change with confirmation, change) · Scopes: `finance.read`, `finance.write`
- `cai.finance.37.budget_season` — seasons, season_tree, season_frame_set, season_frame_versions, frame_proposal (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
- `cai.finance.38.entry_detail` — entry, open_items (read) · Scopes: `finance.read`
- `cai.finance.39.budget_period` — show, set, tree, frame_set, frame_versions, statement, window_position_create, window_position_update (read, change with confirmation) · Scopes: `finance.read`, `finance.write`
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
