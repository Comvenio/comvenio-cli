import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  handleIngredientOperation,
  type IngredientCommandOpts,
} from "../src/commands/ingredient.ts";
import {
  handleIngredientCategoryOperation,
  type IngredientCategoryCommandOpts,
} from "../src/commands/ingredient-category.ts";
import {
  handleShoppingOperation,
  type ShoppingCommandOpts,
} from "../src/commands/shopping.ts";
import type { ComvenioClient } from "../src/http.ts";

type Call = { method: string; service: string; path: string; body?: unknown };

function recordingClient(result: unknown = {}): { client: ComvenioClient; calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string, service: string, path: string, body?: unknown) => {
    calls.push({ method, service, path, body });
    return Promise.resolve(result as never);
  };
  return {
    calls,
    client: {
      get: (service, path) => record("GET", service, path),
      post: (service, path, body) => record("POST", service, path, body),
      patch: (service, path, body) => record("PATCH", service, path, body),
      put: (service, path, body) => record("PUT", service, path, body),
      del: (service, path) => record("DELETE", service, path),
      postForm: (service, path, body) => record("POST_FORM", service, path, body),
      service: (service, path) => record("GET", service, path),
    },
  };
}

async function ingredient(action: string, id?: string, opts: IngredientCommandOpts = {}): Promise<Call[]> {
  const { client, calls } = recordingClient([]);
  await handleIngredientOperation({ action, id, opts, client, clubId: "club-1" });
  return calls;
}

async function category(action: string, id?: string, opts: IngredientCategoryCommandOpts = {}): Promise<Call[]> {
  const { client, calls } = recordingClient([]);
  await handleIngredientCategoryOperation({ action, id, opts, client, clubId: "club-1" });
  return calls;
}

async function shopping(action: string, id?: string, opts: ShoppingCommandOpts = {}): Promise<Call[]> {
  const { client, calls } = recordingClient([]);
  await handleShoppingOperation({ action, id, opts, client, clubId: "club-1" });
  return calls;
}

describe("ingredient CLI route contracts", () => {
  test("maps club list filters to the real supply route", async () => {
    expect(await ingredient("list", undefined, { search: "Kartoffel", category: "category-1", limit: "25" }))
      .toEqual([{
        method: "GET",
        service: "supply",
        path: "/ingredients/club/club-1/ingredients?search=Kartoffel&category_id=category-1&limit=25",
        body: undefined,
      }]);
  });

  test("creates and updates ingredients from JSON payloads", async () => {
    const file = join(import.meta.dir, "fixtures", "ingredient-create.json");
    expect(await ingredient("create", undefined, { file })).toEqual([{
      method: "POST",
      service: "supply",
      path: "/ingredients/club/club-1",
      body: {
        name: "Kartoffeln",
        unit: "kg",
        cost_per_unit: 1.8,
        allergen_ids: [],
        colorant_ids: [],
        category_ids: ["category-1"],
      },
    }]);
    expect((await ingredient("update", "ingredient-1", { file }))[0]?.path).toBe("/ingredients/ingredient-1");
    expect((await ingredient("delete", "ingredient-1"))[0]).toEqual({
      method: "DELETE",
      service: "supply",
      path: "/ingredients/ingredient-1",
      body: undefined,
    });
  });
});

describe("ingredient-category CLI route contracts", () => {
  test("uses the category tree and initialization routes", async () => {
    expect(await category("tree", undefined, { type: "food_type", includeInactive: true })).toEqual([{
      method: "GET",
      service: "supply",
      path: "/ingredient-categories/by-club/club-1/tree?category_type=food_type&active_only=false",
      body: undefined,
    }]);
    expect(await category("init")).toEqual([{
      method: "POST",
      service: "supply",
      path: "/ingredient-categories/initialize/club-1",
      body: undefined,
    }]);
  });

  test("assigns and unassigns categories with the backend body", async () => {
    expect(await category("assign", "ingredient-1", { category: "category-1" })).toEqual([{
      method: "POST",
      service: "supply",
      path: "/ingredient-categories/assign",
      body: { ingredient_id: "ingredient-1", category_id: "category-1" },
    }]);
    expect((await category("unassign", "ingredient-1", { category: "category-1" }))[0]?.path)
      .toBe("/ingredient-categories/unassign");
  });

  test("injects the active club into category create and preserves soft delete by default", async () => {
    const file = join(import.meta.dir, "fixtures", "ingredient-category-create.json");
    expect(await category("create", undefined, { file })).toEqual([{
      method: "POST",
      service: "supply",
      path: "/ingredient-categories/",
      body: {
        name: "Knollengemuese",
        category_type: "food_type",
        parent_id: "category-root",
        club_id: "club-1",
      },
    }]);
    expect((await category("delete", "category-1"))[0]?.path)
      .toBe("/ingredient-categories/category-1?hard_delete=false");
  });
});

describe("shopping CLI route contracts", () => {
  test("covers shopping-list and item CRUD routes", async () => {
    const listFile = join(import.meta.dir, "fixtures", "shopping-list-create.json");
    const itemFile = join(import.meta.dir, "fixtures", "shopping-item-create.json");
    expect((await shopping("create", undefined, { file: listFile }))[0]).toMatchObject({
      method: "POST",
      path: "/shopping/club/club-1/lists",
    });
    expect((await shopping("update", "list-1", { file: listFile }))[0]?.path)
      .toBe("/shopping/club/club-1/lists/list-1");
    expect((await shopping("item-add", "list-1", { file: itemFile }))[0]?.path)
      .toBe("/shopping/club/club-1/lists/list-1/items");
    expect((await shopping("item-update", "item-1", { file: itemFile }))[0]?.path)
      .toBe("/shopping/club/club-1/items/item-1");
    expect((await shopping("item-delete", "item-1"))[0]?.method).toBe("DELETE");
  });

  test("passes purchased as the required query parameter", async () => {
    expect(await shopping("purchased", "item-1", { purchased: "false" })).toEqual([{
      method: "PATCH",
      service: "supply",
      path: "/shopping/club/club-1/items/item-1/purchased?purchased=false",
      body: undefined,
    }]);
  });

  test("generates from recipes and menus with their distinct request contracts", async () => {
    expect(await shopping("generate-from-recipe", "recipe-1", {
      portions: "80",
      name: "Fest-Einkauf",
    })).toEqual([{
      method: "POST",
      service: "supply",
      path: "/shopping/club/club-1/generate-from-recipe/recipe-1",
      body: { portions: 80, name: "Fest-Einkauf" },
    }]);
    expect(await shopping("generate-from-menu", "menu-1", { description: "Alles fuer Samstag" }))
      .toEqual([{
        method: "POST",
        service: "supply",
        path: "/shopping/club/club-1/generate-from-menu/menu-1",
        body: { description: "Alles fuer Samstag" },
      }]);
  });

  test("covers ongoing procurement, templates and assigned-user mutations", async () => {
    const itemFile = join(import.meta.dir, "fixtures", "procurement-item-create.json");
    expect(await shopping("procurement-list", undefined, {
      buildingId: "building-1",
    })).toEqual([{
      method: "GET",
      service: "supply",
      path: "/procurement/ongoing?club_id=club-1&building_id=building-1",
      body: undefined,
    }]);
    expect(await shopping("procurement-templates", undefined, {
      roomId: "room-1",
    })).toEqual([{
      method: "GET",
      service: "supply",
      path: "/procurement/templates?club_id=club-1&room_id=room-1",
      body: undefined,
    }]);
    expect((await shopping("procurement-activate", "template-1"))[0]).toEqual({
      method: "POST",
      service: "supply",
      path: "/procurement/templates/template-1/activate?club_id=club-1",
      body: {},
    });
    expect((await shopping("procurement-add", undefined, { file: itemFile }))[0])
      .toMatchObject({
        method: "POST",
        path: "/procurement/items?club_id=club-1",
      });
    expect((await shopping("procurement-purchase", "item-1"))[0]).toEqual({
      method: "PATCH",
      service: "supply",
      path: "/procurement/items/item-1/purchase?club_id=club-1",
      body: undefined,
    });
  });

  test("covers Supply-RBAC protected procurement template management", async () => {
    const createFile = join(
      import.meta.dir,
      "fixtures",
      "procurement-template-create.json",
    );
    const updateFile = join(
      import.meta.dir,
      "fixtures",
      "procurement-template-update.json",
    );
    expect((await shopping("procurement-template-create", undefined, {
      file: createFile,
    }))[0]).toMatchObject({
      method: "POST",
      path: "/procurement/templates?club_id=club-1",
    });
    expect((await shopping("procurement-template-update", "template-1", {
      file: updateFile,
    }))[0]).toMatchObject({
      method: "PATCH",
      path: "/procurement/templates/template-1?club_id=club-1",
    });
    expect(
      (await shopping("procurement-template-deactivate", "template-1"))[0],
    ).toEqual({
      method: "PATCH",
      service: "supply",
      path: "/procurement/templates/template-1?club_id=club-1",
      body: { is_active: false },
    });
  });
});

describe("supply machine-readable schemas", () => {
  const schema = (name: string) => JSON.parse(
    readFileSync(join(import.meta.dir, "..", "src", "schema", `${name}.json`), "utf8"),
  );

  test("publishes command, enum and exclusion contracts", () => {
    expect(schema("ingredient").enums.unit).toContain("pinch");
    expect(schema("ingredient-category").commands).toContain("assign");
    expect(schema("ingredient-category").notes.join(" ")).toContain("akzeptiert club_id im Body");
    expect(schema("shopping").commands.generate).toEqual(["generate-from-recipe", "generate-from-menu"]);
    expect(schema("shopping").commands.procurement).toContain("procurement-template-deactivate");
    expect(schema("shopping").procurement_location_rule).toContain("Exakt eines");
    expect(schema("shopping").procurement_article_rule).toContain("Mindestens eines");
    expect(schema("shopping").procurement_article_rule).toContain("beide dürfen");
    expect(schema("shopping").excluded_routes).toContain("Interne Service-Routen");
  });
});
