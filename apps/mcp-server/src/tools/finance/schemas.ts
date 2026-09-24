import { z } from "zod";
import type { K14ActionId, K14ActionSchemaContract } from "./types.ts";
import { HUB_ACTION_SCHEMAS } from "./hub.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(200);
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(512) }).strict();
const base = { club_id: uuid, department_id: uuid.nullable().optional(), confirmation: confirmation.optional() } as const;
const single = <S extends z.ZodRawShape>(shape: S) => z.object({ ...base, ...shape }).strict();
const grouped = <S extends z.ZodRawShape>(operation: string, shape: S) => z.object({ ...base, operation: z.literal(operation), ...shape }).strict();
const union = <T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>(items: T) => z.discriminatedUnion("operation", items as never);
const contract = (input: z.ZodType): K14ActionSchemaContract => ({ input, output: z.json() });
const nonEmpty = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().refine((value) => Object.keys(value).length > 0, "Mindestens ein Änderungsfeld ist erforderlich.");

// Die Grenzen des Dienstes: `year` ge=1900 le=2200 (schemas/finance_plan.py),
// `name` max 200, `notes` max 500 (models/finance_plan.py), `description` max 500.
const year = z.number().int().min(1900).max(2200);
// Ein Verein darf im Minus stehen — das Kapital ist die einzige Zahl, die
// negativ sinnvoll ist. Planwerte und Buchungsbeträge tragen ihre Richtung
// dagegen im Feldnamen (revenue/expense), ein negativer Wert dort wäre eine
// zweite, widersprüchliche Angabe derselben Richtung.
const capitalCents = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const plannedCents = z.number().int().min(0).max(1_000_000_000);
// Der Dienst verlangt `amount > 0` (BookingEntryCreate.xor_amount).
const bookedCents = z.number().int().min(1).max(1_000_000_000);
const notes = z.string().max(500);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Erwartet wird ein Datum als JJJJ-MM-TT.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, "Das Datum gibt es nicht.");
const contextType = z.enum(["EVENT", "EVENT_SERIES", "BOOKING_OBJECT", "DEPARTMENT", "GENERAL"]);
const sourceType = z.enum([
  "MANUAL", "MEMBER_FEE_COLLECTION", "DONATION", "EXPENSE_RECORD", "PAYMENT_TRANSACTION", "CLUB_INVOICE",
  "SPONSORING_DEAL", "SPONSORING_REVENUE", "SPONSORING_ASSIGNMENT", "EVENT_TICKET", "BOOKING_FEE", "SUPPLY_PURCHASE",
]);

const positionFields = {
  name: short,
  category: z.string().trim().min(1).max(100).default("Allgemein"),
  position_number: z.number().int().min(0).max(100_000).default(0),
  context_type: contextType.default("GENERAL"),
  context_id: uuid.nullable().optional(),
  parent_position_id: uuid.nullable().optional(),
  revenue_planned_cents: plannedCents.default(0),
  expense_planned_cents: plannedCents.default(0),
  // Der Dienst nimmt sie beim Anlegen entgegen (BudgetPositionCreate); ohne sie
  // liesse sich ein uebernommener Plan nicht mit Vorjahreszahlen fuellen.
  revenue_previous_year_cents: plannedCents.default(0),
  expense_previous_year_cents: plannedCents.default(0),
  comment: notes.nullable().optional(),
  recurring: z.boolean().default(true),
} as const;
const positionChanges = nonEmpty({
  name: short.optional(), category: z.string().trim().min(1).max(100).optional(), position_number: z.number().int().min(0).max(100_000).optional(),
  context_type: contextType.optional(), context_id: uuid.nullable().optional(), parent_position_id: uuid.nullable().optional(),
  revenue_planned_cents: plannedCents.optional(), expense_planned_cents: plannedCents.optional(),
  revenue_previous_year_cents: plannedCents.optional(), expense_previous_year_cents: plannedCents.optional(),
  // `department_id` steht auch in `base`, dort aber als KONTEXT. Hier ist es
  // das Ziel einer Verschiebung und wird vom ToolSet gegen den Kontext geprueft.
  department_id: uuid.nullable().optional(),
  comment: notes.nullable().optional(), recurring: z.boolean().optional(),
});
// Genau eine Richtung je Buchung — dieselbe Regel wie `xor_amount` im Dienst,
// hier vorgezogen, damit der Fehler vor dem Netz auffällt und als Satz statt
// als 422 zurückkommt.
const oneDirection = <T extends z.ZodTypeAny>(schema: T, required: boolean) => schema.refine((value: unknown) => {
  const row = value as { revenue_cents?: number | null; expense_cents?: number | null };
  const hasRevenue = row.revenue_cents !== undefined && row.revenue_cents !== null;
  const hasExpense = row.expense_cents !== undefined && row.expense_cents !== null;
  return required ? hasRevenue !== hasExpense : !(hasRevenue && hasExpense);
}, required ? "Genau eines von revenue_cents oder expense_cents muss gesetzt sein." : "revenue_cents und expense_cents schliessen einander aus.");
const entryChanges = nonEmpty({
  description: z.string().trim().min(1).max(500).optional(), revenue_cents: bookedCents.nullable().optional(), expense_cents: bookedCents.nullable().optional(),
  booking_date: isoDate.optional(), receipt_file_id: uuid.nullable().optional(), notes: notes.nullable().optional(),
  // buchhaltung-13-04: der Grund der Korrektur (Pflicht, wenn die Buchung
  // beanstandet ist — der Dienst prüft das), Geldkonto und Eigenbeleg-Grund.
  reason: z.string().trim().min(1).max(500).optional(), money_account_id: uuid.nullable().optional(),
  receipt_exemption_reason: z.string().trim().min(10).max(500).nullable().optional(),
}).refine(
  // A reason alone changes nothing — the service answers unchanged and the
  // objection stays open (13 review R1-13).
  (value) => Object.keys(value).some((key) => key !== "reason"),
  "Ein Grund allein ändert nichts — mindestens ein Feld der Buchung angeben.",
);

export const K14_ACTION_SCHEMAS: Readonly<Record<K14ActionId, K14ActionSchemaContract>> = Object.freeze({
  "cai.finance.01.plan_list": contract(single({ limit: z.number().int().min(1).max(100).default(50) })),
  "cai.finance.02.plan_show": contract(single({ year })),
  "cai.finance.03.plan_create": contract(single({ year, available_capital_cents: capitalCents.default(0), notes: notes.nullable().optional() })),
  "cai.finance.04.plan_update": contract(single({ year, changes: nonEmpty({ available_capital_cents: capitalCents.optional(), notes: notes.nullable().optional(), status: z.enum(["DRAFT", "ACTIVE"]).optional() }) })),
  // `status: "CLOSED"` fehlt in plan_update mit Absicht: Schliessen läuft über
  // die eigene Aktion, die den Übergang prüft und bestätigen lässt.
  "cai.finance.05.plan_close": contract(single({ year, force: z.boolean().default(false), note: notes.nullable().optional() })),
  "cai.finance.07.plan_copy": contract(single({ year, source_year: year, position_ids: z.array(uuid).min(1).max(500).nullable().optional(), include_non_recurring: z.boolean().default(false) })
    .refine((value) => value.year !== value.source_year, "Quell- und Zieljahr dürfen nicht dasselbe sein.")),
  "cai.finance.08.position_list": contract(single({ year, limit: z.number().int().min(1).max(200).default(100) })),
  "cai.finance.09.position_create": contract(single({ year, ...positionFields })),
  "cai.finance.10.position_show": contract(single({ position_id: uuid })),
  "cai.finance.11.position_update": contract(single({ position_id: uuid, changes: positionChanges })),
  "cai.finance.12.position_delete": contract(single({ position_id: uuid })),
  "cai.finance.13.position_import_shopping": contract(single({ position_id: uuid, overwrite: z.boolean().default(false) })),
  // `department_id` ist hier Pflicht und überschreibt das optionale Feld aus
  // `base`. Damit läuft die Abteilung durch denselben Abgleich wie überall
  // sonst — ein eigener Feldname wäre am Wächter des ToolSets vorbeigelaufen.
  "cai.finance.14.summary": contract(union([
    grouped("total", { year }),
    grouped("by_department", { year, department_id: uuid }),
  ])),
  "cai.finance.15.entry_list": contract(single({ position_id: uuid, source_type: sourceType.optional(), limit: z.number().int().min(1).max(200).default(100) })),
  "cai.finance.16.entry_create": contract(oneDirection(single({
    position_id: uuid, description: z.string().trim().min(1).max(500), revenue_cents: bookedCents.nullable().optional(), expense_cents: bookedCents.nullable().optional(),
    booking_date: isoDate, receipt_file_id: uuid.nullable().optional(), notes: notes.nullable().optional(),
  }), true)),
  "cai.finance.17.entry_show": contract(single({ entry_id: uuid })),
  "cai.finance.18.entry_update": contract(single({ entry_id: uuid, changes: oneDirection(entryChanges, false) })),
  "cai.finance.19.entry_delete": contract(single({ entry_id: uuid })),
  "cai.finance.20.entry_approve": contract(single({ entry_id: uuid, note: notes.nullable().optional() })),

  // Finance Hub vollständig (hub.ts).
  ...(HUB_ACTION_SCHEMAS as Record<string, K14ActionSchemaContract>),
}) as Readonly<Record<K14ActionId, K14ActionSchemaContract>>;
