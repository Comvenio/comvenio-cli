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

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

Sign in with `comvenio login`; which scopes a given action needs is shown by `comvenio action list --json`. Sponsors, products and assignments always belong to a club and mostly to a department.

## Workflows

### The four levels

The sponsoring model has four levels: a **sponsor** (advertiser) with a logo and responsible club members is assigned to a **sponsorship product**; the **assignment** carries price, term and status; a product can have several **contract versions** with their own terms, and each assignment can carry its own private contract documents.

### Creating a sponsor

1. Required fields are department, name and email address.
2. If a file is also given when creating a sponsor, the CLI uploads it as a public sponsor logo and links the file ID directly to the sponsor.
3. Logo, contact person and other fields can be updated at any time afterwards.

### Creating a sponsorship product

A product describes an offer from the club, for example "jersey sponsor", "billboard advertising" or a "gold package". Prices are given in cents; without explicit values, creating a product defaults to the currency `EUR`, the billing interval `year` and a term of twelve months. A product can later be marked inactive without losing its existing assignments.

### Contract version of a product

A new contract version reflects changed terms without overwriting older contracts — older versions remain as history. A new version can explicitly supersede a previous one and limit its validity; an internal note can be stored alongside it. Contract files are always private. Changing or deleting a version always needs the specific version ID in addition to the product ID; when changing a version, a new contract file can be uploaded in the same action. Deleting removes a version as a soft delete; other versions are unaffected.

### Assigning a sponsor to a product

An assignment connects a sponsor to a product for a period and optionally a quantity; a price or total price can override the product's default. An assignment can be adjusted later, or ended with a note and an end date. Deleted assignments can optionally be included in the listing.

### Uploading an assignment's contract document

Signed contract documents are attached to a single assignment, are stored privately, and carry the sponsor ID as a sub-context.

### Responsible club members

Responsible members with a role can be assigned to a sponsor; one of them can be marked as the primary contact. This expects a member ID specifically, not a user ID.

### File visibility

Logos are public by default so event and club pages can show them. Product contracts and signed assignment documents are always private instead. Uploads run through the shared file mechanism, see [dateien.md](dateien.md).

### Scope boundary

A global ad marketplace or platform-wide billing are deliberately not part of local sponsoring. Managing sponsors, products, contract versions, assignments and responsible members is fully reachable through the actions described here.

## Examples

```bash
comvenio sponsor add \
  --department-id <department-id> \
  --name "Muster GmbH" \
  --email sponsor@example.org \
  --website https://example.org \
  --contact-person "<contact-person>" \
  --contact-phone "+49 123 456789" \
  --organization-type crafts \
  --file ./logo.png \
  --json

comvenio sponsor list --json
comvenio sponsor list --department-id <department-id> --json
comvenio sponsor show <sponsor-id> --json
comvenio sponsor update <sponsor-id> --contact-person "<contact-person>" --json
comvenio sponsor logo <sponsor-id> --file ./neues-logo.svg --json
comvenio sponsor delete <sponsor-id> --json
```

```bash
comvenio sponsor product-add \
  --department-id <department-id> \
  --name "Gold-Paket" \
  --description "Logo auf Website, Plakat und Bande" \
  --conditions "Laufzeit mindestens zwölf Monate" \
  --price-cents 150000 \
  --currency EUR \
  --billing-interval year \
  --duration-months 12 \
  --sort-order 10 \
  --json

comvenio sponsor product-list --json
comvenio sponsor product-list --include-inactive --json
comvenio sponsor product-update <product-id> --price-cents 175000 --json
comvenio sponsor product-update <product-id> --inactive --json
comvenio sponsor product-delete <product-id> --json
```

```bash
comvenio sponsor contract-add <product-id> \
  --file ./gold-paket-2027.pdf \
  --label "Konditionen 2027" \
  --valid-from 2027-01-01T00:00:00+01:00 \
  --price-cents 175000 \
  --currency EUR \
  --billing-interval year \
  --duration-months 12 \
  --json

comvenio sponsor contract-list <product-id> --json

comvenio sponsor contract-update <product-id> \
  --contract-version <version-id> \
  --price-cents 185000 \
  --valid-until 2027-12-31T23:59:59+01:00 \
  --json

comvenio sponsor contract-delete <product-id> --contract-version <version-id> --json
```

Optional version chaining: `--supersedes-version <id>` names the superseded version, `--superseded-valid-until <iso>` limits it, `--valid-until <iso>` limits the new version, `--note <text>` stores an internal note.

```bash
comvenio sponsor assign \
  --department-id <department-id> \
  --sponsor <sponsor-id> \
  --product <product-id> \
  --quantity 1 \
  --starts-at 2027-01-01T00:00:00+01:00 \
  --ends-at 2027-12-31T23:59:59+01:00 \
  --json

comvenio sponsor assignment-list --json
comvenio sponsor assignment-list --sponsor <sponsor-id> --status active --json
comvenio sponsor assignment-update <assignment-id> --quantity 2 --json
comvenio sponsor cancel <assignment-id> --note "Vertrag beendet" --ends-at <iso> --json
```

`--include-deleted` extends `assignment-list` with deleted assignments.

```bash
comvenio sponsor doc-upload <assignment-id> --file ./unterschrieben.pdf --json
comvenio sponsor doc-list <assignment-id> --json
```

```bash
comvenio sponsor responsible-add <sponsor-id> \
  --department-id <department-id> \
  --member <member-id> \
  --role responsible \
  --primary \
  --json

comvenio sponsor responsible-list --sponsor <sponsor-id> --json
comvenio sponsor responsible-update <responsible-assignment-id> --role contact --json
comvenio sponsor responsible-remove <responsible-assignment-id> --json
```

## Commands and actions

<!-- gen:docs befehle -->
_Generated from the coverage registry (`bun run gen:docs`) — do not edit by hand._

**sponsor** — complete

- `comvenio sponsor list`
- `comvenio sponsor show`
- `comvenio sponsor add`
- `comvenio sponsor update`
- `comvenio sponsor delete`
- `comvenio sponsor logo`
- `comvenio sponsor product-list`
- `comvenio sponsor product-add`
- `comvenio sponsor product-update`
- `comvenio sponsor product-delete`
- `comvenio sponsor contract-list`
- `comvenio sponsor contract-add`
- `comvenio sponsor contract-update`
- `comvenio sponsor contract-delete`
- `comvenio sponsor assignment-list`
- `comvenio sponsor assign`
- `comvenio sponsor assignment-update`
- `comvenio sponsor cancel`
- `comvenio sponsor doc-list`
- `comvenio sponsor doc-upload`
- `comvenio sponsor responsible-list`
- `comvenio sponsor responsible-add`
- `comvenio sponsor responsible-update`
- `comvenio sponsor responsible-remove`
- Fields and values: `comvenio schema sponsor --json`
<!-- /gen:docs -->

## Errors

- `VALIDATION_FAILED` — a required field such as department, name or email is missing, or a field has the wrong format. More: `comvenio help fehler VALIDATION_FAILED`
- `NOT_FOUND` — sponsor, product, contract version or assignment does not exist or is not visible. More: `comvenio help fehler NOT_FOUND`
- `PERMISSION_DENIED` — the scopes are correct, but the club role does not allow sponsoring management in this department. More: `comvenio help fehler PERMISSION_DENIED`
- `SCOPE_REQUIRED` — the sign-in is missing the scope for sponsoring actions. More: `comvenio help fehler SCOPE_REQUIRED`
- `CONFLICT` — the product, contract version or assignment was changed in the meantime, or does not allow the action in its current state. More: `comvenio help fehler CONFLICT`
