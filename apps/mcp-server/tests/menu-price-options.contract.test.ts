import { describe, expect, test } from "bun:test";

import { PublicResponseRedactor } from "../src/public/redaction.ts";
import { K11_ACTION_SCHEMAS } from "../src/tools/supply-menu-shopping/schemas.ts";

const clubId = "11111111-1111-4111-8111-111111111111";
const menuId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const recipeId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const priceOptions = [
  { label: "0,2 l", price: 4.2 },
  { label: "Flasche", price: 15.6 },
];

describe("menu price options contract", () => {
  test("accepts named variants for add, update and declarative apply", () => {
    expect(K11_ACTION_SCHEMAS["cai.menu.04.add_item"].input.parse({
      club_id: clubId,
      menu_id: menuId,
      item: { recipe_id: recipeId, name: "Riesling", price_options: priceOptions },
    })).toBeDefined();

    expect(K11_ACTION_SCHEMAS["cai.menu.05.update_item"].input.parse({
      club_id: clubId,
      item_id: itemId,
      changes: { price_options: priceOptions },
    })).toBeDefined();

    expect(K11_ACTION_SCHEMAS["cai.menu.09.apply"].input.parse({
      club_id: clubId,
      menu: {
        name: "Weinfest",
        items: [{ recipe_id: recipeId, name: "Riesling", price_options: priceOptions }],
      },
    })).toBeDefined();
  });

  test("keeps named variants in the public menu projection", () => {
    const result = new PublicResponseRedactor().redact({
      alias: "public_menu",
      request_id: requestId,
      expected_club_id: clubId,
      response: {
        id: menuId,
        club_id: clubId,
        name: "Weinfest",
        items: [{
          id: itemId,
          name: "Riesling",
          selling_price: 4.2,
          price_options: priceOptions,
          is_active: true,
        }],
      },
    });

    expect(result).toMatchObject({
      items: [{ name: "Riesling", price: 4.2, price_options: priceOptions }],
    });
  });
});
