---
id: sponsoring
kategorie: thema
domaenen: [sponsor]
stichwoerter: [sponsoring, sponsor, advertiser, contract, assignment]
---

# Local sponsoring

## Purpose

The sponsoring area lets a club manage its local sponsors, their offers (sponsorship products), the assignment of a sponsor to a product including contract terms, and the responsible club members and contract documents that go with it.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club enables and which scopes they need is shown by `comvenio action list --json`. Sponsors, products and assignments always belong to a club and to a department (`department_id`).

## Workflows

### The four levels

The sponsoring model has four levels: a **sponsor** (advertiser) with a logo and responsible club members is assigned to a **sponsorship product**; the **assignment** carries price, term and status; a product can have several **contract versions** with their own terms, and each assignment can carry its own private contract documents.

### Creating a sponsor (`cai.sponsor.03.add`)

Required fields are department (`department_id`), name and email address. A logo is not passed when creating a sponsor, but set afterward, separately: upload the file first (see [dateien.md](dateien.md)), then link its file ID with `cai.sponsor.06.logo` — setting the logo is `critical_write`. Contact person and other fields can be updated at any time with `cai.sponsor.04.update` (`operation: update`); moving to another department goes through `operation: move_department` and is `critical_write`.

### Creating a sponsorship product (`cai.sponsor.08.product_add`)

A product describes an offer from the club, for example "jersey sponsor", "billboard advertising" or a "gold package", and also belongs to a department (`department_id`). Prices are given in cents; without explicit values, creating a product defaults to the currency `EUR`, the billing interval `year` and a term of twelve months. A product can later be marked inactive with `cai.sponsor.09.product_update` (`operation: update`, field `is_active`) without losing its existing assignments; a department change again goes through `operation: move_department` (`critical_write`).

### Contract version of a product

A new contract version (`cai.sponsor.12.contract_add`) reflects changed terms without overwriting older contracts — older versions remain as history. The contract file is uploaded first (see [dateien.md](dateien.md)); its file ID is required as `contract_file_id`. A new version can explicitly supersede a previous one and limit its validity; an internal note can be stored alongside it. Changing (`cai.sponsor.13.contract_update`, `operation: update`) or replacing the file (`operation: replace_file`) always needs the specific version ID in addition to the product ID. Deleting (`cai.sponsor.14.contract_delete`) removes a version as a soft delete and is `critical_write`; other versions are unaffected.

### Assigning a sponsor to a product (`cai.sponsor.16.assign`)

An assignment connects a sponsor to a product for a period and optionally a quantity; a price or total price can override the product's default. Creating it is `critical_write`: the call first returns only a preview with `preview_id` and `confirmation_token`, and only `comvenio action confirm --preview-id <id> --confirmation-token=<token> --idempotency-key <key>` carries out the assignment. An assignment can be adjusted later through `cai.sponsor.17.assignment_update`, or ended with a note and an end date through `cai.sponsor.18.cancel` — both also `critical_write`. `cai.sponsor.15.assignment_list` can optionally include deleted assignments.

### Uploading an assignment's contract document (`cai.sponsor.20.doc_upload`)

Signed contract documents are passed directly to a single assignment as a file transfer (`asset`: `source_file_id`, `filename`, `content_type`, `expected_size`), are stored privately, and carry a label. `cai.sponsor.19.doc_list` lists an assignment's documents.

### Responsible club members

Responsible members with a role can be assigned to a sponsor with `cai.sponsor.22.responsible_add` (department, sponsor, member ID, role, `is_primary`); one of them can be marked as the primary contact. This expects a member ID specifically, not a user ID. `cai.sponsor.23.responsible_update` changes an assignment, `cai.sponsor.24.responsible_remove` removes it (`critical_write`); `cai.sponsor.21.responsible_list` filters by sponsor or member.

### File visibility

Logos are public by default so event and club pages can show them. Product contracts and signed assignment documents are always private instead. Uploads run through the shared file mechanism, see [dateien.md](dateien.md).

### Scope boundary

A global ad marketplace or platform-wide billing are deliberately not part of local sponsoring. Managing sponsors, products, contract versions, assignments and responsible members is fully reachable through the actions described here.

## Examples

```bash
comvenio action call cai.sponsor.03.add --input '{
  "department_id": "<department-id>",
  "company_name": "Muster GmbH",
  "contact_email": "sponsor@example.org",
  "website_url": "https://example.org",
  "contact_person": "<contact-person>",
  "contact_phone": "+49 123 456789",
  "organization_type": "crafts"
}'

comvenio action call cai.sponsor.01.list --input '{"limit":50}'
comvenio action call cai.sponsor.02.show --input '{"sponsor_id":"<sponsor-id>"}'
comvenio action call cai.sponsor.04.update --input '{"operation":"update","sponsor_id":"<sponsor-id>","changes":{"contact_person":"<contact-person>"}}'
comvenio action call cai.sponsor.06.logo --input '{"sponsor_id":"<sponsor-id>","logo_file_id":"<file-id>"}'
comvenio action call cai.sponsor.05.delete --input '{"sponsor_id":"<sponsor-id>"}'
```

```bash
comvenio action call cai.sponsor.08.product_add --input '{
  "department_id": "<department-id>",
  "name": "Gold-Paket",
  "description": "Logo auf Website, Plakat und Bande",
  "conditions": "Laufzeit mindestens zwölf Monate",
  "default_unit_price_cents": 150000,
  "currency": "EUR",
  "billing_interval": "year",
  "default_duration_months": 12,
  "sort_order": 10
}'

comvenio action call cai.sponsor.07.product_list --input '{"include_inactive":false,"limit":50}'
comvenio action call cai.sponsor.09.product_update --input '{"operation":"update","product_id":"<product-id>","changes":{"default_unit_price_cents":175000}}'
comvenio action call cai.sponsor.09.product_update --input '{"operation":"update","product_id":"<product-id>","changes":{"is_active":false}}'
comvenio action call cai.sponsor.10.product_delete --input '{"product_id":"<product-id>"}'
```

```bash
comvenio action call cai.sponsor.12.contract_add --input '{
  "product_id": "<product-id>",
  "contract_file_id": "<file-id>",
  "label": "Konditionen 2027",
  "valid_from": "2027-01-01T00:00:00+01:00",
  "unit_price_cents": 175000,
  "currency": "EUR",
  "billing_interval": "year",
  "duration_months": 12
}'

comvenio action call cai.sponsor.11.contract_list --input '{"product_id":"<product-id>","limit":50}'

comvenio action call cai.sponsor.13.contract_update --input '{
  "operation": "update",
  "product_id": "<product-id>",
  "contract_version_id": "<version-id>",
  "changes": { "unit_price_cents": 185000, "valid_until": "2027-12-31T23:59:59+01:00" }
}'

comvenio action call cai.sponsor.14.contract_delete --input '{"product_id":"<product-id>","contract_version_id":"<version-id>"}'
```

Optional version chaining in `contract_add`: `supersedes_version_id` names the superseded version, `superseded_valid_until` limits it, `valid_until` limits the new version, `note` stores an internal note.

```bash
comvenio action call cai.sponsor.16.assign --input '{
  "department_id": "<department-id>",
  "sponsor_id": "<sponsor-id>",
  "product_id": "<product-id>",
  "quantity": 1,
  "starts_at": "2027-01-01T00:00:00+01:00",
  "ends_at": "2027-12-31T23:59:59+01:00"
}'
# response returns preview_id, confirmation_token, target, current state, diff and risk
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token=<confirmation-token> \
  --idempotency-key <idempotency-key>

comvenio action call cai.sponsor.15.assignment_list --input '{"sponsor_id":"<sponsor-id>","status":"active","include_deleted":false,"limit":50}'
comvenio action call cai.sponsor.17.assignment_update --input '{"assignment_id":"<assignment-id>","changes":{"quantity":2}}'
comvenio action call cai.sponsor.18.cancel --input '{"assignment_id":"<assignment-id>","cancellation_note":"Vertrag beendet","ends_at":"2027-06-30T23:59:59+02:00"}'
```

`assignment_update` and `cancel` are also `critical_write` and run through the same preview/confirm sequence.

```bash
comvenio action call cai.sponsor.20.doc_upload --input '{
  "assignment_id": "<assignment-id>",
  "asset": {
    "source_file_id": "<file-id>",
    "filename": "unterschrieben.pdf",
    "content_type": "application/pdf",
    "expected_size": 512000
  },
  "label": "Unterschriebener Vertrag"
}'

comvenio action call cai.sponsor.19.doc_list --input '{"assignment_id":"<assignment-id>","limit":50}'
```

```bash
comvenio action call cai.sponsor.22.responsible_add --input '{
  "department_id": "<department-id>",
  "sponsor_id": "<sponsor-id>",
  "member_id": "<member-id>",
  "role": "responsible",
  "is_primary": true
}'

comvenio action call cai.sponsor.21.responsible_list --input '{"sponsor_id":"<sponsor-id>","limit":50}'
comvenio action call cai.sponsor.23.responsible_update --input '{"responsible_id":"<responsible-assignment-id>","changes":{"role":"contact"}}'
comvenio action call cai.sponsor.24.responsible_remove --input '{"responsible_id":"<responsible-assignment-id>"}'
```

## Commands and actions

<!-- gen:docs befehle -->

**sponsor**

- `cai.sponsor.01.list` — list (read) · Scopes: `sponsor.read`
- `cai.sponsor.02.show` — show (read) · Scopes: `sponsor.read`
- `cai.sponsor.03.add` — add (change) · Scopes: `sponsor.write`
- `cai.sponsor.04.update` — update, move_department (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.05.delete` — delete (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.06.logo` — set (change with confirmation) · Scopes: `sponsor.write`, `files.read`
- `cai.sponsor.07.product_list` — list (read) · Scopes: `sponsor.read`
- `cai.sponsor.08.product_add` — add (change) · Scopes: `sponsor.write`
- `cai.sponsor.09.product_update` — update, move_department (change, change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.10.product_delete` — delete (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.11.contract_list` — list (read) · Scopes: `sponsor.read`
- `cai.sponsor.12.contract_add` — add (change) · Scopes: `sponsor.write`, `files.read`
- `cai.sponsor.13.contract_update` — update, replace_file (change) · Scopes: `sponsor.write`, `files.read`
- `cai.sponsor.14.contract_delete` — delete (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.15.assignment_list` — list (read) · Scopes: `sponsor.read`
- `cai.sponsor.16.assign` — assign (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.17.assignment_update` — update (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.18.cancel` — cancel (change with confirmation) · Scopes: `sponsor.write`
- `cai.sponsor.19.doc_list` — list (read) · Scopes: `sponsor.read`, `files.read`
- `cai.sponsor.20.doc_upload` — upload (change) · Scopes: `sponsor.write`, `files.import`, `files.write`
- `cai.sponsor.21.responsible_list` — list (read) · Scopes: `sponsor.read`, `member.read.basic`
- `cai.sponsor.22.responsible_add` — add (change) · Scopes: `sponsor.write`
- `cai.sponsor.23.responsible_update` — update (change) · Scopes: `sponsor.write`
- `cai.sponsor.24.responsible_remove` — remove (change with confirmation) · Scopes: `sponsor.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"sponsor"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — a required field such as department, name or email is missing, or a field has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — sponsor, product, contract version or assignment does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow sponsoring management in this department. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for sponsoring actions. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the product, contract version or assignment was changed in the meantime, or does not allow the action in its current state. More: `comvenio help fehler CONFLICT`
- `OUTCOME_UNKNOWN` — for a write action (for example `assign`, `cancel` or `delete`), the server response was missing; before retrying, use a read action to check whether the change already landed. More: `comvenio help fehler OUTCOME_UNKNOWN`
