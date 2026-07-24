import type { CAC } from "cac";
import { loadState } from "../auth.ts";
import { createClient } from "../http.ts";
import { output, renderTable } from "../format.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { uploadClubFile } from "../util/upload.ts";

type SponsorRead = {
  id?: string;
  company_name?: string;
  contact_email?: string;
  contact_person?: string | null;
  contact_phone?: string | null;
  website_url?: string | null;
  organization_type?: string | null;
  club_department_id?: string | null;
  logo_file_id?: string | null;
  is_verified?: boolean;
  [key: string]: unknown;
};

type ProductRead = {
  id?: string;
  name?: string;
  club_department_id?: string | null;
  default_unit_price_cents?: number | null;
  currency?: string;
  billing_interval?: string;
  default_duration_months?: number | null;
  is_active?: boolean;
  contract_template_file_id?: string | null;
  [key: string]: unknown;
};

type AssignmentRead = {
  id?: string;
  club_department_id?: string | null;
  advertiser_id?: string;
  sponsorship_product_id?: string;
  product_name?: string | null;
  quantity?: number;
  status?: string;
  effective_total_price_cents?: number | null;
  currency?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  [key: string]: unknown;
};

type ResponsibleRead = {
  id?: string;
  advertiser_id?: string;
  member_id?: string;
  role?: string;
  is_primary?: boolean;
  [key: string]: unknown;
};

export type SponsorCommandOpts = {
  json?: boolean;
  club?: string;
  departmentId?: string;
  includeInactive?: boolean;
  includeDeleted?: boolean;
  status?: string;
  file?: string;
  label?: string;
  public?: boolean;
  name?: string;
  email?: string;
  website?: string;
  contactPerson?: string;
  contactPhone?: string;
  address?: string;
  organizationType?: string;
  description?: string;
  conditions?: string;
  priceCents?: string;
  currency?: string;
  billingInterval?: string;
  durationMonths?: string;
  sortOrder?: string;
  inactive?: boolean;
  active?: string;
  sponsor?: string;
  product?: string;
  quantity?: string;
  totalPriceCents?: string;
  startsAt?: string;
  endsAt?: string;
  note?: string;
  validFrom?: string;
  validUntil?: string;
  supersededValidUntil?: string;
  supersedesVersion?: string;
  contractVersion?: string;
  member?: string;
  role?: string;
  primary?: boolean;
  notPrimary?: boolean;
};

export const sponsorDeletePath = (sponsorId: string): string => `/advertisers/${sponsorId}`;

export const contractVersionPath = (productId: string, versionId: string): string =>
  `/club-sponsorship-products/${productId}/contract-versions/${versionId}`;

const cents = (value?: string): number | undefined =>
  value == null || value === "" ? undefined : Math.round(Number(value));

function optionalBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} erwartet true oder false.`);
}
const intValue = (value?: string): number | undefined =>
  value == null || value === "" ? undefined : Number.parseInt(value, 10);

export function buildContractVersionUpdateBody(
  opts: SponsorCommandOpts,
  contractFileId?: string,
): Record<string, unknown> {
  return prune({
    label: opts.label,
    conditions: opts.conditions,
    unit_price_cents: cents(opts.priceCents),
    currency: opts.currency,
    billing_interval: opts.billingInterval,
    duration_months: intValue(opts.durationMonths),
    contract_file_id: contractFileId,
    valid_from: opts.validFrom,
    valid_until: opts.validUntil,
    supersedes_version_id: opts.supersedesVersion,
    note: opts.note,
  });
}

function qs(params: Record<string, string | boolean | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out.set(key, String(value));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

async function findProduct(client: ReturnType<typeof createClient>, clubId: string, productId: string): Promise<ProductRead | undefined> {
  const rows = await client.get<ProductRead[]>(
    "marketing",
    `/club-sponsorship-products/${qs({ club_id: clubId, active_only: false })}`,
  );
  return rows.find((p) => p.id === productId);
}

async function findAssignment(client: ReturnType<typeof createClient>, clubId: string, assignmentId: string): Promise<AssignmentRead | undefined> {
  const rows = await client.get<AssignmentRead[]>(
    "marketing",
    `/sponsorship-assignments/${qs({ club_id: clubId, include_deleted: true })}`,
  );
  return rows.find((a) => a.id === assignmentId);
}

export function registerSponsorCommands(cli: CAC): void {
  cli
    .command(
      "sponsor <action> [id]",
      "Lokale Sponsoren: list|add|update|delete|logo | product-* | assign* | contract-* | doc-* | responsible-*",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--department-id <id>", "club_department_id fuer lokales Sponsoring")
    .option("--include-inactive", "product-list: inaktive Produkte einschliessen")
    .option("--include-deleted", "assignment-list: geloeschte Assignments einschliessen")
    .option("--status <v>", "assignment-list/update: active|cancelled|expired|...")
    .option("--file <path>", "Logo-/Vertragsdatei")
    .option("--label <v>", "Datei-Label/Bucket im content-service")
    .option("--public", "Datei public hochladen (Logo ja, Vertraege normalerweise nein)")
    .option("--name <v>", "Sponsor-/Produktname")
    .option("--email <v>", "Kontakt-E-Mail des Sponsors")
    .option("--website <v>", "Website-URL")
    .option("--contact-person <v>", "Ansprechpartner")
    .option("--contact-phone <v>", "Telefon")
    .option("--address <v>", "Anschrift")
    .option("--organization-type <v>", "Branche/Typ, z.B. restaurant|crafts")
    .option("--description <v>", "Produktbeschreibung")
    .option("--conditions <v>", "Sponsoring-Konditionen")
    .option("--price-cents <n>", "Preis in Cent")
    .option("--currency <v>", "Waehrung, Default EUR")
    .option("--billing-interval <v>", "year|month|one_time|...")
    .option("--duration-months <n>", "Standard-/Vertragslaufzeit in Monaten")
    .option("--sort-order <n>", "Sortierreihenfolge")
    .option("--inactive", "product-update: is_active=false")
    .option("--active <boolean>", "product-update: is_active explizit true|false")
    .option("--sponsor <id>", "Advertiser/Sponsor-ID")
    .option("--product <id>", "SponsoringProduct-ID")
    .option("--quantity <n>", "Menge, Default 1")
    .option("--total-price-cents <n>", "Gesamtpreis-Override in Cent")
    .option("--starts-at <iso>", "Startzeitpunkt ISO")
    .option("--ends-at <iso>", "Endzeitpunkt ISO")
    .option("--note <text>", "Notiz")
    .option("--valid-from <iso>", "contract-add/update: neue Konditionen ab")
    .option("--valid-until <iso>", "contract-add/update: gueltig bis")
    .option("--superseded-valid-until <iso>", "contract-add: alten Vertrag gueltig bis setzen")
    .option("--supersedes-version <id>", "contract-add/update: explizit abgeloeste Version")
    .option("--contract-version <id>", "contract-update/delete: Vertragsversions-ID")
    .option("--member <id>", "Member-ID fuer responsible-*")
    .option("--role <v>", "Rolle des Verantwortlichen")
    .option("--primary", "responsible-add/update: Hauptverantwortlicher")
    .option("--not-primary", "responsible-update: Hauptverantwortlich explizit entfernen")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (action: string, id: string | undefined, opts: SponsorCommandOpts) => {
      const state = await loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      switch (action) {
        case "list": {
          const sponsors = await client.get<SponsorRead[]>(
            "marketing",
            `/advertisers/${qs({ club_id: clubId, club_department_id: opts.departmentId })}`,
          );
          output(sponsors, opts.json, () =>
            sponsors.length
              ? renderTable(sponsors, [
                  { header: "Name", width: 28, get: (s) => String(s.company_name ?? "-") },
                  { header: "E-Mail", width: 28, get: (s) => String(s.contact_email ?? "-") },
                  { header: "Department", width: 36, get: (s) => String(s.club_department_id ?? "-") },
                  { header: "ID", width: 36, get: (s) => String(s.id ?? "-") },
                ])
              : "Keine Sponsoren.",
          );
          break;
        }
        case "show": {
          if (!id) throw new Error("sponsor show <sponsor-id> benoetigt eine ID.");
          const sponsor = await client.get<SponsorRead>("marketing", `/advertisers/${id}`);
          output(sponsor, opts.json, () =>
            [
              `Sponsor:    ${sponsor.company_name ?? "-"}`,
              `ID:         ${sponsor.id ?? id}`,
              `E-Mail:     ${sponsor.contact_email ?? "-"}`,
              `Kontakt:    ${sponsor.contact_person ?? "-"}`,
              `Telefon:    ${sponsor.contact_phone ?? "-"}`,
              `Department: ${sponsor.club_department_id ?? "-"}`,
              `Logo:       ${sponsor.logo_file_id ?? "-"}`,
            ].join("\n"),
          );
          break;
        }
        case "add": {
          if (!opts.departmentId) throw new Error("sponsor add benoetigt --department-id <id>.");
          if (!opts.name || !opts.email) throw new Error("sponsor add benoetigt --name und --email.");
          const sponsor = await client.post<SponsorRead>(
            "marketing",
            "/advertisers/",
            prune({
              company_name: opts.name,
              contact_email: opts.email,
              website_url: opts.website,
              contact_person: opts.contactPerson,
              contact_phone: opts.contactPhone,
              address: opts.address,
              organization_type: opts.organizationType,
              club_id: clubId,
              club_department_id: opts.departmentId,
            }),
          );
          let logo: unknown = null;
          if (opts.file) {
            const uploaded = await uploadClubFile({
              client,
              clubId,
              departmentId: opts.departmentId,
              path: opts.file,
              contextType: "advertiser",
              contextId: sponsor.id,
              label: opts.label ?? "logo",
              isPublic: opts.public ?? true,
            });
            logo = uploaded;
            await client.patch("marketing", `/advertisers/${sponsor.id}`, { logo_file_id: uploaded.file_id });
            sponsor.logo_file_id = uploaded.file_id;
          }
          output({ sponsor, logo }, opts.json, () =>
            `Sponsor angelegt: ${sponsor.company_name} (${sponsor.id})${logo ? " mit Logo" : ""}`,
          );
          break;
        }
        case "update": {
          if (!id) throw new Error("sponsor update <sponsor-id> benoetigt eine ID.");
          const body = prune({
            company_name: opts.name,
            contact_email: opts.email,
            website_url: opts.website,
            contact_person: opts.contactPerson,
            contact_phone: opts.contactPhone,
            address: opts.address,
            organization_type: opts.organizationType,
            club_department_id: opts.departmentId,
          });
          if (Object.keys(body).length === 0) throw new Error("sponsor update braucht mindestens ein Feld.");
          const sponsor = await client.patch<SponsorRead>("marketing", `/advertisers/${id}`, body);
          output(sponsor, opts.json, () => `Sponsor aktualisiert: ${sponsor.company_name ?? id}`);
          break;
        }
        case "delete": {
          if (!id) throw new Error("sponsor delete <sponsor-id> benoetigt eine ID.");
          await client.del("marketing", sponsorDeletePath(id));
          output({ deleted: id }, opts.json, () => `Sponsor geloescht: ${id}`);
          break;
        }
        case "logo": {
          if (!id) throw new Error("sponsor logo <sponsor-id> benoetigt eine ID.");
          if (!opts.file) throw new Error("sponsor logo benoetigt --file <path>.");
          const sponsor = await client.get<SponsorRead>("marketing", `/advertisers/${id}`);
          const departmentId = opts.departmentId ?? String(sponsor.club_department_id ?? "");
          if (!departmentId) throw new Error("Sponsor hat kein Department; --department-id explizit setzen.");
          const uploaded = await uploadClubFile({
            client,
            clubId,
            departmentId,
            path: opts.file,
            contextType: "advertiser",
            contextId: id,
            label: opts.label ?? "logo",
            isPublic: opts.public ?? true,
          });
          const updated = await client.patch<SponsorRead>("marketing", `/advertisers/${id}`, {
            logo_file_id: uploaded.file_id,
          });
          output({ sponsor: updated, logo: uploaded }, opts.json, () =>
            `Logo gesetzt: ${updated.company_name ?? id} -> file_id ${uploaded.file_id}`,
          );
          break;
        }
        case "product-list": {
          const products = await client.get<ProductRead[]>(
            "marketing",
            `/club-sponsorship-products/${qs({
              club_id: clubId,
              club_department_id: opts.departmentId,
              active_only: opts.includeInactive ? false : true,
            })}`,
          );
          output(products, opts.json, () =>
            products.length
              ? renderTable(products, [
                  { header: "Name", width: 30, get: (p) => String(p.name ?? "-") },
                  { header: "Preis", width: 10, get: (p) => String(p.default_unit_price_cents ?? "-") },
                  { header: "Intervall", width: 10, get: (p) => String(p.billing_interval ?? "-") },
                  { header: "ID", width: 36, get: (p) => String(p.id ?? "-") },
                ])
              : "Keine Sponsoring-Angebote.",
          );
          break;
        }
        case "product-add": {
          if (!opts.departmentId) throw new Error("sponsor product-add benoetigt --department-id <id>.");
          if (!opts.name) throw new Error("sponsor product-add benoetigt --name.");
          const product = await client.post<ProductRead>(
            "marketing",
            "/club-sponsorship-products/",
            prune({
              club_id: clubId,
              club_department_id: opts.departmentId,
              name: opts.name,
              description: opts.description,
              conditions: opts.file ? undefined : opts.conditions,
              default_unit_price_cents: opts.file ? undefined : cents(opts.priceCents),
              currency: opts.currency ?? "EUR",
              billing_interval: opts.billingInterval ?? "year",
              default_duration_months: intValue(opts.durationMonths) ?? 12,
              sort_order: intValue(opts.sortOrder) ?? 0,
            }),
          );
          let contract: unknown = null;
          if (opts.file) {
            const uploaded = await uploadClubFile({
              client,
              clubId,
              departmentId: opts.departmentId,
              path: opts.file,
              contextType: "sponsorship_product",
              contextId: product.id,
              label: opts.label ?? "contract_template",
              isPublic: false,
            });
            contract = await client.post<Record<string, unknown>>(
              "marketing",
              `/club-sponsorship-products/${product.id}/contract-versions`,
              prune({
                label: opts.label ?? "Aktuelle Konditionen",
                conditions: opts.conditions,
                unit_price_cents: cents(opts.priceCents),
                currency: opts.currency ?? "EUR",
                billing_interval: opts.billingInterval ?? "year",
                duration_months: intValue(opts.durationMonths) ?? 12,
                contract_file_id: uploaded.file_id,
                valid_from: new Date().toISOString(),
                note: opts.note,
              }),
            );
            product.contract_template_file_id = uploaded.file_id;
          }
          output({ product, contract }, opts.json, () =>
            `Sponsoring-Angebot angelegt: ${product.name} (${product.id})${contract ? " mit Vertrag" : ""}`,
          );
          break;
        }
        case "product-update": {
          if (!id) throw new Error("sponsor product-update <product-id> benoetigt eine ID.");
          if (opts.inactive && opts.active !== undefined) {
            throw new Error("--inactive und --active koennen nicht kombiniert werden.");
          }
          const body = prune({
            name: opts.name,
            description: opts.description,
            conditions: opts.conditions,
            default_unit_price_cents: cents(opts.priceCents),
            currency: opts.currency,
            billing_interval: opts.billingInterval,
            default_duration_months: intValue(opts.durationMonths),
            sort_order: intValue(opts.sortOrder),
            club_department_id: opts.departmentId,
            is_active: opts.inactive ? false : optionalBoolean(opts.active, "--active"),
          });
          if (Object.keys(body).length === 0) throw new Error("product-update braucht mindestens ein Feld.");
          const product = await client.patch<ProductRead>("marketing", `/club-sponsorship-products/${id}`, body);
          output(product, opts.json, () => `Sponsoring-Angebot aktualisiert: ${product.name ?? id}`);
          break;
        }
        case "product-delete": {
          if (!id) throw new Error("sponsor product-delete <product-id> benoetigt eine ID.");
          await client.del("marketing", `/club-sponsorship-products/${id}`);
          output({ deleted: id }, opts.json, () => `Sponsoring-Angebot geloescht: ${id}`);
          break;
        }
        case "contract-list": {
          if (!id) throw new Error("sponsor contract-list <product-id> benoetigt eine Product-ID.");
          const versions = await client.get<Record<string, unknown>[]>(
            "marketing",
            `/club-sponsorship-products/${id}/contract-versions`,
          );
          output(versions, opts.json, () =>
            versions.length
              ? renderTable(versions, [
                  { header: "Status", width: 10, get: (v) => String(v.status ?? "-") },
                  { header: "Label", width: 24, get: (v) => String(v.label ?? "-") },
                  { header: "Ab", width: 20, get: (v) => String(v.valid_from ?? "-") },
                  { header: "file_id", width: 36, get: (v) => String(v.contract_file_id ?? "-") },
                ])
              : "Keine Vertragsversionen.",
          );
          break;
        }
        case "contract-add": {
          if (!id) throw new Error("sponsor contract-add <product-id> benoetigt eine Product-ID.");
          if (!opts.file) throw new Error("contract-add benoetigt --file <path>.");
          if (!opts.validFrom) throw new Error("contract-add benoetigt --valid-from <iso>.");
          const product = await findProduct(client, clubId, id);
          const departmentId = opts.departmentId ?? String(product?.club_department_id ?? "");
          if (!departmentId) throw new Error("Product-Department nicht ermittelbar; --department-id setzen.");
          const uploaded = await uploadClubFile({
            client,
            clubId,
            departmentId,
            path: opts.file,
            contextType: "sponsorship_product",
            contextId: id,
            label: opts.label ?? "contract_version",
            isPublic: false,
          });
          const version = await client.post<Record<string, unknown>>(
            "marketing",
            `/club-sponsorship-products/${id}/contract-versions`,
            prune({
              label: opts.label,
              conditions: opts.conditions,
              unit_price_cents: cents(opts.priceCents),
              currency: opts.currency ?? "EUR",
              billing_interval: opts.billingInterval ?? "year",
              duration_months: intValue(opts.durationMonths) ?? 12,
              contract_file_id: uploaded.file_id,
              valid_from: opts.validFrom,
              valid_until: opts.validUntil,
              supersedes_version_id: opts.supersedesVersion,
              superseded_valid_until: opts.supersededValidUntil,
              note: opts.note,
            }),
          );
          output({ version, file: uploaded }, opts.json, () =>
            `Vertragsversion angelegt: ${version.id ?? ""} -> file_id ${uploaded.file_id}`,
          );
          break;
        }
        case "contract-update": {
          if (!id) throw new Error("sponsor contract-update <product-id> benoetigt eine Product-ID.");
          if (!opts.contractVersion) {
            throw new Error("contract-update benoetigt --contract-version <version-id>.");
          }

          let uploaded: { file_id: string } | undefined;
          if (opts.file) {
            const product = await findProduct(client, clubId, id);
            const departmentId = opts.departmentId ?? String(product?.club_department_id ?? "");
            if (!departmentId) throw new Error("Product-Department nicht ermittelbar; --department-id setzen.");
            uploaded = await uploadClubFile({
              client,
              clubId,
              departmentId,
              path: opts.file,
              contextType: "sponsorship_product",
              contextId: id,
              label: opts.label ?? "contract_version",
              isPublic: false,
            });
          }

          const body = buildContractVersionUpdateBody(opts, uploaded?.file_id);
          if (Object.keys(body).length === 0) {
            throw new Error("contract-update braucht mindestens ein Feld oder --file.");
          }
          const version = await client.patch<Record<string, unknown>>(
            "marketing",
            contractVersionPath(id, opts.contractVersion),
            body,
          );
          output({ version, file: uploaded ?? null }, opts.json, () =>
            `Vertragsversion aktualisiert: ${version.id ?? opts.contractVersion}`,
          );
          break;
        }
        case "contract-delete": {
          if (!id) throw new Error("sponsor contract-delete <product-id> benoetigt eine Product-ID.");
          if (!opts.contractVersion) {
            throw new Error("contract-delete benoetigt --contract-version <version-id>.");
          }
          await client.del("marketing", contractVersionPath(id, opts.contractVersion));
          output({ deleted: opts.contractVersion, product_id: id }, opts.json, () =>
            `Vertragsversion geloescht: ${opts.contractVersion}`,
          );
          break;
        }
        case "assignment-list": {
          const assignments = await client.get<AssignmentRead[]>(
            "marketing",
            `/sponsorship-assignments/${qs({
              club_id: clubId,
              club_department_id: opts.departmentId,
              advertiser_id: opts.sponsor,
              status: opts.status,
              include_deleted: opts.includeDeleted,
            })}`,
          );
          output(assignments, opts.json, () =>
            assignments.length
              ? renderTable(assignments, [
                  { header: "Produkt", width: 26, get: (a) => String(a.product_name ?? a.sponsorship_product_id ?? "-") },
                  { header: "Status", width: 10, get: (a) => String(a.status ?? "-") },
                  { header: "Preis", width: 10, get: (a) => String(a.effective_total_price_cents ?? "-") },
                  { header: "ID", width: 36, get: (a) => String(a.id ?? "-") },
                ])
              : "Keine Sponsor-Zuordnungen.",
          );
          break;
        }
        case "assign": {
          if (!opts.departmentId) throw new Error("sponsor assign benoetigt --department-id <id>.");
          if (!opts.sponsor || !opts.product) throw new Error("sponsor assign benoetigt --sponsor und --product.");
          const assignment = await client.post<AssignmentRead>(
            "marketing",
            "/sponsorship-assignments/",
            prune({
              club_id: clubId,
              club_department_id: opts.departmentId,
              advertiser_id: opts.sponsor,
              sponsorship_product_id: opts.product,
              quantity: intValue(opts.quantity) ?? 1,
              unit_price_cents: cents(opts.priceCents),
              total_price_cents: cents(opts.totalPriceCents),
              currency: opts.currency ?? "EUR",
              starts_at: opts.startsAt,
              ends_at: opts.endsAt,
              note: opts.note,
            }),
          );
          output(assignment, opts.json, () =>
            `Sponsor zugewiesen: ${opts.sponsor} -> ${assignment.product_name ?? opts.product} (${assignment.id})`,
          );
          break;
        }
        case "assignment-update": {
          if (!id) throw new Error("sponsor assignment-update <assignment-id> benoetigt eine ID.");
          const body = prune({
            sponsorship_product_id: opts.product,
            quantity: intValue(opts.quantity),
            unit_price_cents: cents(opts.priceCents),
            total_price_cents: cents(opts.totalPriceCents),
            currency: opts.currency,
            status: opts.status,
            starts_at: opts.startsAt,
            ends_at: opts.endsAt,
            note: opts.note,
          });
          if (Object.keys(body).length === 0) throw new Error("assignment-update braucht mindestens ein Feld.");
          const assignment = await client.patch<AssignmentRead>("marketing", `/sponsorship-assignments/${id}`, body);
          output(assignment, opts.json, () => `Zuordnung aktualisiert: ${assignment.id ?? id}`);
          break;
        }
        case "cancel": {
          if (!id) throw new Error("sponsor cancel <assignment-id> benoetigt eine ID.");
          const assignment = await client.post<AssignmentRead>(
            "marketing",
            `/sponsorship-assignments/${id}/cancel`,
            prune({ cancellation_note: opts.note, ends_at: opts.endsAt }),
          );
          output(assignment, opts.json, () => `Zuordnung gekuendigt: ${assignment.id ?? id}`);
          break;
        }
        case "doc-upload": {
          if (!id) throw new Error("sponsor doc-upload <assignment-id> benoetigt eine Assignment-ID.");
          if (!opts.file) throw new Error("doc-upload benoetigt --file <path>.");
          const assignment = await findAssignment(client, clubId, id);
          if (!assignment) throw new Error(`Assignment nicht gefunden oder nicht lesbar: ${id}`);
          const departmentId = opts.departmentId ?? String(assignment.club_department_id ?? "");
          if (!departmentId) throw new Error("Assignment-Department nicht ermittelbar; --department-id setzen.");
          const uploaded = await uploadClubFile({
            client,
            clubId,
            departmentId,
            path: opts.file,
            contextType: "sponsorship_assignment",
            contextId: id,
            subContextId: String(assignment.advertiser_id ?? opts.sponsor ?? ""),
            label: opts.label ?? "contract",
            isPublic: false,
          });
          output(uploaded, opts.json, () => `Vertrag hochgeladen: file_id ${uploaded.file_id}`);
          break;
        }
        case "doc-list": {
          if (!id) throw new Error("sponsor doc-list <assignment-id> benoetigt eine Assignment-ID.");
          const files = await client.get<Record<string, unknown>[]>(
            "content",
            `/files/by-context/${clubId}/sponsorship_assignment/${id}`,
          );
          output(files, opts.json, () =>
            files.length
              ? renderTable(files, [
                  { header: "Datei", width: 34, get: (f) => String(f.filename ?? "-") },
                  { header: "Label", width: 14, get: (f) => String(f.context_label ?? "-") },
                  { header: "ID", width: 36, get: (f) => String(f.id ?? "-") },
                ])
              : "Keine Vertragsdokumente.",
          );
          break;
        }
        case "responsible-list": {
          const rows = await client.get<ResponsibleRead[]>(
            "marketing",
            `/sponsor-member-assignments/${qs({
              club_id: clubId,
              club_department_id: opts.departmentId,
              advertiser_id: opts.sponsor ?? id,
              member_id: opts.member,
            })}`,
          );
          output(rows, opts.json, () =>
            rows.length
              ? renderTable(rows, [
                  { header: "Member", width: 36, get: (r) => String(r.member_id ?? "-") },
                  { header: "Rolle", width: 16, get: (r) => String(r.role ?? "-") },
                  { header: "Primaer", width: 8, get: (r) => (r.is_primary ? "ja" : "nein") },
                  { header: "ID", width: 36, get: (r) => String(r.id ?? "-") },
                ])
              : "Keine Verantwortlichen.",
          );
          break;
        }
        case "responsible-add": {
          if (!opts.departmentId) throw new Error("responsible-add benoetigt --department-id <id>.");
          if (!opts.sponsor && !id) throw new Error("responsible-add benoetigt --sponsor <id> oder <sponsor-id>.");
          if (!opts.member) throw new Error("responsible-add benoetigt --member <id>.");
          const row = await client.post<ResponsibleRead>(
            "marketing",
            "/sponsor-member-assignments/",
            prune({
              club_id: clubId,
              club_department_id: opts.departmentId,
              advertiser_id: opts.sponsor ?? id,
              member_id: opts.member,
              role: opts.role ?? "responsible",
              is_primary: opts.primary ?? false,
              note: opts.note,
            }),
          );
          output(row, opts.json, () => `Verantwortlichen zugewiesen: ${row.member_id} (${row.id})`);
          break;
        }
        case "responsible-update": {
          if (!id) throw new Error("responsible-update <assignment-id> benoetigt eine ID.");
          if (opts.primary && opts.notPrimary) {
            throw new Error("--primary und --not-primary koennen nicht kombiniert werden.");
          }
          const body = prune({
            member_id: opts.member,
            role: opts.role,
            is_primary: opts.primary ? true : opts.notPrimary ? false : undefined,
            note: opts.note,
          });
          if (Object.keys(body).length === 0) throw new Error("responsible-update braucht mindestens ein Feld.");
          const row = await client.patch<ResponsibleRead>("marketing", `/sponsor-member-assignments/${id}`, body);
          output(row, opts.json, () => `Verantwortlichen-Zuordnung aktualisiert: ${row.id ?? id}`);
          break;
        }
        case "responsible-remove": {
          if (!id) throw new Error("responsible-remove <assignment-id> benoetigt eine ID.");
          await client.del("marketing", `/sponsor-member-assignments/${id}`);
          output({ deleted: id }, opts.json, () => `Verantwortlichen-Zuordnung geloescht: ${id}`);
          break;
        }
        default:
          throw new Error(
            `Unbekannte Aktion "${action}". Verfuegbar: list, show, add, update, delete, logo, product-list, product-add, product-update, product-delete, contract-list, contract-add, contract-update, contract-delete, assignment-list, assign, assignment-update, cancel, doc-list, doc-upload, responsible-list, responsible-add, responsible-update, responsible-remove`,
          );
      }
    });
}
