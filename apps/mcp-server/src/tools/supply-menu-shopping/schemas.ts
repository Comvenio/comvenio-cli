import { z } from "zod";

import type { K11ActionId, K11ActionSchemaContract } from "./types.ts";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(300);
const text = z.string().max(30_000);
const money = z.number().finite().min(0).max(100_000_000);
const quantity = z.number().finite().gt(0).max(100_000_000);
const unit = z.enum(["gr", "kg", "ml", "l", "pc", "portion", "tsp", "tbsp", "cup", "pinch"]);
const recipeType = z.enum(["food", "drink"]);
const ageGroup = z.enum(["none", "teen", "adult"]);
const categoryType = z.enum(["main", "food_type", "meat_type", "dietary", "origin", "custom"]);
const contextType = z.enum(["club", "event", "object", "meeting"]);
const shoppingStatus = z.enum(["draft", "active", "completed", "cancelled"]);
const confirmation = z.object({ preview_id: uuid, confirmation_token: z.string().min(32).max(256) }).strict();
const club = { club_id: uuid } as const;
const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) } as const;
const single = <T extends z.ZodRawShape>(shape: T) => z.object({ ...club, ...shape, confirmation: confirmation.optional() }).strict();
const grouped = <N extends string, T extends z.ZodRawShape>(operation: N, shape: T) => z.object({ ...club, operation: z.literal(operation), ...shape, confirmation: confirmation.optional() }).strict();
const union = (items: [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]) => z.discriminatedUnion("operation", items);
const contract = (input: z.ZodType): K11ActionSchemaContract => ({ input, output: z.json() });

const recipeIngredientByName = z.object({ name: short.max(200), quantity: quantity.default(1), unit: unit.default("pc") }).strict();
const recipeIngredientById = z.object({ ingredient_id: uuid, quantity, unit, notes: z.string().max(500).nullable().optional() }).strict();
const recipeChanges = z.object({
  name: short.max(200).optional(), description: text.nullable().optional(), instructions: text.nullable().optional(), category: z.string().max(100).nullable().optional(),
  default_selling_price: money.nullable().optional(), type_of_recipe: recipeType.optional(), age_group: ageGroup.optional(),
  ingredients: z.array(recipeIngredientById).max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Änderung ist erforderlich.");

const ingredientFields = {
  name: short.max(200), description: text.nullable().optional(), unit, cost_per_unit: money.nullable().optional(), supplier: z.string().max(200).nullable().optional(),
  allergen_ids: z.array(uuid).max(100).default([]), colorant_ids: z.array(uuid).max(100).default([]), category_ids: z.array(uuid).max(100).default([]),
} as const;
const ingredientChanges = z.object({
  name: short.max(200).optional(), description: text.nullable().optional(), unit: unit.optional(), cost_per_unit: money.nullable().optional(), supplier: z.string().max(200).nullable().optional(),
  allergen_ids: z.array(uuid).max(100).optional(), colorant_ids: z.array(uuid).max(100).optional(), category_ids: z.array(uuid).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const categoryFields = {
  name: short.max(100), category_type: categoryType, description: text.nullable().optional(), parent_id: uuid.nullable().optional(), icon: z.string().max(50).nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu).nullable().optional(), sort_order: z.number().int().min(-100_000).max(100_000).default(0), is_active: z.boolean().default(true),
} as const;
const categoryChanges = z.object({
  name: short.max(100).optional(), category_type: categoryType.optional(), description: text.nullable().optional(), parent_id: uuid.nullable().optional(),
  icon: z.string().max(50).nullable().optional(), color: z.string().regex(/^#[0-9a-f]{6}$/iu).nullable().optional(), sort_order: z.number().int().min(-100_000).max(100_000).optional(), is_active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const shoppingItemFields = {
  ingredient_id: uuid.nullable().optional(), name: short.max(200).optional(), quantity, unit, estimated_cost: money.nullable().optional(), actual_cost: money.nullable().optional(),
  is_purchased: z.boolean().default(false), notes: z.string().max(500).nullable().optional(),
} as const;
const shoppingItem = z.object(shoppingItemFields).strict().superRefine((value, context) => {
  if (!value.ingredient_id && !value.name) context.addIssue({ code: "custom", message: "Name oder Zutat ist erforderlich." });
});
const shoppingItemChanges = z.object({
  ingredient_id: uuid.nullable().optional(), name: short.max(200).nullable().optional(), quantity: quantity.optional(), unit: unit.optional(),
  estimated_cost: money.nullable().optional(), actual_cost: money.nullable().optional(), is_purchased: z.boolean().optional(), notes: z.string().max(500).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const shoppingListFields = {
  name: short.max(200), description: z.string().max(500).nullable().optional(), status: shoppingStatus.default("draft"), total_estimated_cost: money.default(0),
  actual_cost: money.default(0), is_completed: z.boolean().default(false), context_type: contextType, context_id: uuid, items: z.array(shoppingItem).max(1_000).default([]),
} as const;
const shoppingListChanges = z.object({
  name: short.max(200).optional(), description: z.string().max(500).nullable().optional(), status: shoppingStatus.optional(), total_estimated_cost: money.optional(),
  actual_cost: money.optional(), is_completed: z.boolean().optional(), items: z.array(shoppingItem).max(1_000).optional(), context_type: contextType.optional(), context_id: uuid.optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const procurementLocationFields = {
  building_id: uuid.optional(),
  room_id: uuid.optional(),
} as const;
const procurementArticleFields = {
  name: short.max(200).optional(),
  ingredient_id: uuid.optional(),
} as const;
const procurementLocationFilter = single({
  ...procurementLocationFields,
  limit: z.number().int().min(1).max(100).default(50),
}).superRefine((value, context) => {
  if (value.building_id && value.room_id) {
    context.addIssue({
      code: "custom",
      message: "Gebäude und Raum dürfen nicht gleichzeitig gesetzt sein.",
    });
  }
});
const procurementItemCreate = single({
  ...procurementArticleFields,
  ...procurementLocationFields,
  quantity,
  unit,
  notes: z.string().max(500).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.building_id) === Boolean(value.room_id)) {
    context.addIssue({
      code: "custom",
      message: "Exakt ein Gebäude oder Raum ist erforderlich.",
    });
  }
  if (Boolean(value.name) === Boolean(value.ingredient_id)) {
    context.addIssue({
      code: "custom",
      message: "Exakt ein Name oder Supply-Artikel ist erforderlich.",
    });
  }
});
const procurementTemplateCreate = single({
  ...procurementArticleFields,
  ...procurementLocationFields,
  default_quantity: quantity,
  unit,
  notes: z.string().max(500).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.building_id) === Boolean(value.room_id)) {
    context.addIssue({
      code: "custom",
      message: "Exakt ein Gebäude oder Raum ist erforderlich.",
    });
  }
  if (Boolean(value.name) === Boolean(value.ingredient_id)) {
    context.addIssue({
      code: "custom",
      message: "Exakt ein Name oder Supply-Artikel ist erforderlich.",
    });
  }
});
const procurementTemplateChanges = z.object({
  name: short.max(200).optional(),
  default_quantity: quantity.optional(),
  unit: unit.optional(),
  notes: z.string().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "Mindestens eine Vorlagenänderung ist erforderlich.",
);

const safeCss = z.string().max(50_000).refine((value) => !/@import|javascript\s*:|expression\s*\(|behavior\s*:|<\/?style|<script/iu.test(value), "Unsicheres CSS ist nicht zulässig.");
const httpsUrl = z.string().url().max(2_000).refine((value) => value.startsWith("https://"), "Nur HTTPS-URLs sind zulässig.");
const color = z.string().regex(/^#[0-9a-f]{6}$/iu);
const overlayBase = { id: uuid, xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100), wPct: z.number().min(5).max(100), rotateDeg: z.number().min(-360).max(360).optional(), locked: z.boolean().optional(), pageIndex: z.number().int().min(0).max(100).optional() } as const;
const overlay = z.discriminatedUnion("kind", [
  z.object({ ...overlayBase, kind: z.literal("image"), url: httpsUrl }).strict(),
  z.object({ ...overlayBase, kind: z.literal("text"), text: z.string().max(5_000), fontSize: z.number().min(6).max(300), fontWeight: z.number().int().min(100).max(900), color, align: z.enum(["left", "center", "right"]), lineHeight: z.number().min(0.5).max(5), backgroundEnabled: z.boolean(), backgroundColor: color, backgroundOpacity: z.number().min(0).max(1), paddingPx: z.number().min(0).max(300), borderRadiusPx: z.number().min(0).max(300) }).strict(),
]);
const menuDesignShape = {
  template: z.enum(["classic", "modern"]).optional(), clubName: z.string().max(200).optional(), menuName: z.string().max(200).optional(), menuDescription: text.nullable().optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  showPrices: z.boolean().optional(), showDescriptions: z.boolean().optional(), showAllergens: z.boolean().optional(), showColorants: z.boolean().optional(),
  pageSettings: z.array(z.object({ columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict()).max(100).optional(),
  baseFontSize: z.number().min(6).max(100).optional(), titleFontSize: z.number().min(6).max(300).optional(), categoryFontSize: z.number().min(6).max(200).optional(),
  background: color.optional(), textColor: color.optional(), mutedTextColor: color.optional(), accentColor: color.optional(), headerBackground: color.optional(), headerTextColor: color.optional(),
  itemGap: z.number().min(0).max(500).optional(), categoryGap: z.number().min(0).max(500).optional(), logoUrl: httpsUrl.optional(), logoPosition: z.enum(["left", "right", "none"]).optional(), logoSize: z.number().min(0).max(1_000).optional(),
  clubNameAlign: z.enum(["left", "center", "right"]).optional(), menuNameAlign: z.enum(["left", "center", "right"]).optional(), categoryOrder: z.array(z.string().max(100)).max(200).optional(), pageBreakAfter: z.array(z.string().max(100)).max(200).optional(),
  showQr: z.boolean().optional(), qrUrl: httpsUrl.optional(), qrPosition: z.enum(["header-right", "header-left"]).optional(), qrSize: z.number().min(20).max(1_000).optional(),
  headerImageUrl: httpsUrl.optional(), showHeaderImage: z.boolean().optional(), headerImageX: z.number().min(0).max(100).optional(), headerImageY: z.number().min(0).max(100).optional(), headerImageZoom: z.number().min(0.1).max(10).optional(), headerImageOpacity: z.number().min(0).max(1).optional(),
  watermarkUrl: httpsUrl.optional(), showWatermark: z.boolean().optional(), watermarkOpacity: z.number().min(0).max(1).optional(), overlays: z.array(overlay).max(100).optional(), custom_css: safeCss.optional(),
} as const;
const menuDesign = z.object(menuDesignShape).strict().refine((value) => Object.keys(value).length > 0, "Mindestens eine Designänderung ist erforderlich.");
const menuFields = { name: short.max(200), description: text.nullable().optional(), category: z.string().max(100).nullable().optional(), is_template: z.boolean().default(false), is_active: z.boolean().default(true) } as const;
const menuItemFields = { menu_id: uuid, recipe_id: uuid.nullable().optional(), name: short.max(200), description: text.nullable().optional(), selling_price: money.nullable().optional(), display_order: z.number().int().min(0).max(100_000).default(0) } as const;
const menuItemChanges = z.object({ name: short.max(200).optional(), description: text.nullable().optional(), selling_price: money.nullable().optional(), display_order: z.number().int().min(0).max(100_000).optional() }).strict().refine((value) => Object.keys(value).length > 0);

export const K11_ACTION_SCHEMAS: Readonly<Record<K11ActionId, K11ActionSchemaContract>> = Object.freeze({
  "cai.recipe.01.create": contract(single({ name: short.max(200), type_of_recipe: recipeType.default("food"), category: z.string().max(100).nullable().optional(), selling_price: money.nullable().optional(), ingredients: z.array(recipeIngredientByName).max(500).default([]), auto_create_missing_ingredients: z.literal(true).default(true) })),
  "cai.recipe.02.from_template": contract(single({ template_id: uuid, custom_price: money.nullable().optional(), custom_name: short.max(200).optional(), auto_create_missing_ingredients: z.literal(true).default(true) })),
  "cai.recipe.03.list": contract(single({ search: z.string().max(200).optional(), ...pagination })),
  "cai.recipe.04.show": contract(single({ recipe_id: uuid, portions: z.number().int().min(1).max(500).default(1) })),
  "cai.recipe.05.update": contract(single({ recipe_id: uuid, changes: recipeChanges })),
  "cai.recipe.06.delete": contract(single({ recipe_id: uuid })),

  "cai.ingredient.01.list": contract(single({ search: z.string().max(200).optional(), category_id: uuid.optional(), ...pagination })),
  "cai.ingredient.02.show": contract(single({ ingredient_id: uuid })),
  "cai.ingredient.03.create": contract(single({ ingredient: z.object(ingredientFields).strict() })),
  "cai.ingredient.04.update": contract(single({ ingredient_id: uuid, changes: ingredientChanges })),
  "cai.ingredient.05.delete": contract(single({ ingredient_id: uuid })),

  "cai.ingredient-category.01.list": contract(single({ category_type: categoryType.optional(), parent_id: uuid.optional(), active_only: z.boolean().default(true) })),
  "cai.ingredient-category.02.roots": contract(single({ category_type: categoryType.optional(), active_only: z.boolean().default(true) })),
  "cai.ingredient-category.03.tree": contract(single({ category_type: categoryType.optional(), active_only: z.boolean().default(true) })),
  "cai.ingredient-category.04.by_ingredient": contract(single({ ingredient_id: uuid })),
  "cai.ingredient-category.05.show": contract(single({ category_id: uuid })),
  "cai.ingredient-category.06.create": contract(single({ category: z.object(categoryFields).strict() })),
  "cai.ingredient-category.07.update": contract(single({ category_id: uuid, changes: categoryChanges })),
  "cai.ingredient-category.08.delete": contract(single({ category_id: uuid, hard_delete: z.boolean().default(false) })),
  "cai.ingredient-category.09.assign": contract(single({ ingredient_id: uuid, category_id: uuid })),
  "cai.ingredient-category.10.unassign": contract(single({ ingredient_id: uuid, category_id: uuid })),
  "cai.ingredient-category.11.init": contract(single({ acknowledge_defaults: z.literal(true) })),

  "cai.shopping.01.list": contract(single({ search: z.string().max(200).optional(), status: shoppingStatus.optional(), ...pagination })),
  "cai.shopping.02.active": contract(single({ ...pagination })),
  "cai.shopping.03.completed": contract(single({ ...pagination })),
  "cai.shopping.04.by_context": contract(single({ context_id: uuid, ...pagination })),
  "cai.shopping.05.by_context_type": contract(single({ context_type: contextType, ...pagination })),
  "cai.shopping.06.show": contract(union([grouped("show", { shopping_list_id: uuid, item_limit: z.number().int().min(1).max(100).default(100) }), grouped("export", { shopping_list_id: uuid, format: z.enum(["csv", "pdf"]).default("pdf") })])),
  "cai.shopping.07.create": contract(single({ shopping_list: z.object(shoppingListFields).strict() })),
  "cai.shopping.08.update": contract(single({ shopping_list_id: uuid, changes: shoppingListChanges })),
  "cai.shopping.09.delete": contract(single({ shopping_list_id: uuid })),
  "cai.shopping.10.item_add": contract(single({ shopping_list_id: uuid, item: shoppingItem })),
  "cai.shopping.11.item_update": contract(single({ item_id: uuid, changes: shoppingItemChanges })),
  "cai.shopping.12.item_delete": contract(single({ item_id: uuid })),
  "cai.shopping.13.purchased": contract(single({ item_id: uuid, purchased: z.boolean() })),
  "cai.shopping.14.generate_from_recipe": contract(single({ recipe_id: uuid, portions: z.number().int().min(1).max(500).default(1), name: short.max(200).optional(), description: z.string().max(500).optional(), output_format: z.enum(["json", "csv", "pdf"]).default("json") })),
  "cai.shopping.15.generate_from_menu": contract(single({ menu_id: uuid, name: short.max(200).optional(), description: z.string().max(500).optional(), output_format: z.enum(["json", "csv", "pdf"]).default("json") })),
  "cai.shopping.procurement.list": contract(procurementLocationFilter),
  "cai.shopping.procurement.templates": contract(procurementLocationFilter),
  "cai.shopping.procurement.activate": contract(single({ template_id: uuid, quantity: quantity.optional(), notes: z.string().max(500).optional() })),
  "cai.shopping.procurement.add": contract(procurementItemCreate),
  "cai.shopping.procurement.purchase": contract(single({ item_id: uuid })),
  "cai.shopping.procurement.template_create": contract(procurementTemplateCreate),
  "cai.shopping.procurement.template_update": contract(single({ template_id: uuid, changes: procurementTemplateChanges })),
  "cai.shopping.procurement.template_deactivate": contract(single({ template_id: uuid })),

  "cai.template.01.dish": contract(union([grouped("list", { search: z.string().max(200).optional(), category: z.string().max(100).optional(), common_only: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }), grouped("show", { template_id: uuid })])),
  "cai.template.02.ingredient": contract(union([grouped("list", { search: z.string().max(200).optional(), common_only: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }), grouped("show", { template_id: uuid })])),

  "cai.menu.01.create": contract(single({ menu: z.object(menuFields).strict() })),
  "cai.menu.02.list": contract(single({ ...pagination })),
  "cai.menu.03.show": contract(single({ menu_id: uuid, item_limit: z.number().int().min(1).max(100).default(100) })),
  "cai.menu.04.add_item": contract(single({ menu_id: uuid, item: z.object({ recipe_id: uuid.nullable().optional(), name: short.max(200), description: text.nullable().optional(), selling_price: money.nullable().optional(), display_order: z.number().int().min(0).max(100_000).default(0) }).strict() })),
  "cai.menu.05.update_item": contract(single({ item_id: uuid, changes: menuItemChanges })),
  "cai.menu.06.delete_item": contract(single({ item_id: uuid })),
  "cai.menu.07.delete": contract(single({ menu_id: uuid })),
  "cai.menu.08.style": contract(single({ menu_id: uuid, design: menuDesign })),
  "cai.menu.09.apply": contract(single({ menu: z.object({ ...menuFields, items: z.array(z.object(menuItemFields).omit({ menu_id: true }).strict()).min(1).max(500), design_config: menuDesign.optional() }).strict() })),
  "cai.menu.10.export": contract(single({ menu_id: uuid, format: z.enum(["pdf", "png"]).default("pdf") })),
});
