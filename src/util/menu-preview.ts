import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type MenuPreviewItem = {
  recipe_id?: string | null;
  name?: string;
  description?: string;
  selling_price?: number | string | null;
  price_options?: Array<{ label?: string; price?: number | string | null }>;
  display_order?: number;
};

export type MenuPreviewRecipe = {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  type_of_recipe?: string;
  age_group?: string;
  recipe_ingredients?: Array<{
    ingredient?: {
      allergens?: Array<{ name?: string; symbol?: string }>;
      colorants?: Array<{ name?: string; e_number?: string }>;
    };
  }>;
};

export type MenuPreviewCard = {
  name?: string;
  description?: string;
  category?: string;
  items?: MenuPreviewItem[];
  design_config?: Record<string, unknown>;
};

export type MenuPreviewValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function euro(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(number)
    : "—";
}

export function validateMenuPreview(card: MenuPreviewCard): MenuPreviewValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items = Array.isArray(card.items) ? card.items : [];
  if (!card.name?.trim()) errors.push("Der Kartenname fehlt.");
  if (items.length === 0) errors.push("Die Karte braucht mindestens einen Eintrag.");

  const orders = new Map<number, number>();
  items.forEach((item, index) => {
    const label = item.name?.trim() || `Eintrag ${index + 1}`;
    if (!item.recipe_id) errors.push(`${label}: recipe_id fehlt; Allergene und Kategorie wären nicht verknüpft.`);
    if (!item.name?.trim()) errors.push(`Eintrag ${index + 1}: name fehlt.`);
    const priceOptions = item.price_options ?? [];
    if (priceOptions.length === 0 && (!Number.isFinite(Number(item.selling_price)) || Number(item.selling_price) < 0)) {
      errors.push(`${label}: selling_price ist ungültig.`);
    }
    priceOptions.forEach((option, optionIndex) => {
      if (!option.label?.trim()) errors.push(`${label}: Ausgabe ${optionIndex + 1} braucht eine Bezeichnung.`);
      if (!Number.isFinite(Number(option.price)) || Number(option.price) < 0) {
        errors.push(`${label}: Preis der Ausgabe "${option.label || optionIndex + 1}" ist ungültig.`);
      }
    });
    if (item.display_order == null) {
      warnings.push(`${label}: display_order fehlt; die Reihenfolge folgt der JSON-Datei.`);
    } else {
      orders.set(item.display_order, (orders.get(item.display_order) ?? 0) + 1);
    }
  });
  for (const [order, count] of orders) {
    if (count > 1) warnings.push(`display_order ${order} wird ${count}-mal verwendet.`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function collectRecipeNotes(recipe?: MenuPreviewRecipe): { allergens: string[]; colorants: string[] } {
  const allergens = new Set<string>();
  const colorants = new Set<string>();
  for (const link of recipe?.recipe_ingredients ?? []) {
    for (const allergen of link.ingredient?.allergens ?? []) {
      if (allergen.name) allergens.add(`${allergen.symbol ?? ""} ${allergen.name}`.trim());
    }
    for (const colorant of link.ingredient?.colorants ?? []) {
      const value = [colorant.e_number, colorant.name].filter(Boolean).join(" ");
      if (value) colorants.add(value);
    }
  }
  return { allergens: [...allergens].sort(), colorants: [...colorants].sort() };
}

function renderMenuCard(
  card: MenuPreviewCard,
  recipes: Map<string, MenuPreviewRecipe>,
  customCss: string,
): string {
  const design = card.design_config ?? {};
  const clubName = String(design.clubName ?? "Verein");
  const menuName = String(design.menuName ?? card.name ?? "Speisekarte");
  const menuDescription = String(design.menuDescription ?? card.description ?? "");
  const logoUrl = typeof design.logoUrl === "string" ? design.logoUrl : "";
  const grouped = new Map<string, Array<{ item: MenuPreviewItem; recipe?: MenuPreviewRecipe }>>();

  (card.items ?? [])
    .map((item) => ({ item, recipe: item.recipe_id ? recipes.get(item.recipe_id) : undefined }))
    // Match PublicMenuCardView: food/drinks first, then category, then item name.
    // This keeps custom CSS based on nth-child/order consistent with the live route.
    .sort((a, b) => {
      const typeA = a.recipe?.type_of_recipe === "drink" ? 1 : 0;
      const typeB = b.recipe?.type_of_recipe === "drink" ? 1 : 0;
      if (typeA !== typeB) return typeA - typeB;
      const category = (a.recipe?.category || "Sonstiges").localeCompare(b.recipe?.category || "Sonstiges", "de");
      return category || String(a.item.name ?? a.recipe?.name ?? "").localeCompare(String(b.item.name ?? b.recipe?.name ?? ""), "de");
    })
    .forEach(({ item, recipe }) => {
      const type = recipe?.type_of_recipe === "drink" ? "Getränke" : "Speisen";
      const category = recipe?.category?.trim() || "Sonstiges";
      const key = `${type} - ${category}`;
      const list = grouped.get(key) ?? [];
      list.push({ item, recipe });
      grouped.set(key, list);
    });

  const categories = [...grouped.entries()];

  const categoryHtml = categories.map(([category, entries]) => {
    const items = entries.map(({ item, recipe }) => {
      const notes = collectRecipeNotes(recipe);
      const description = item.description ?? recipe?.description ?? "";
      const age = recipe?.age_group === "teen" ? "Ab 16 Jahren" : recipe?.age_group === "adult" ? "Ab 18 Jahren" : "";
      const priceOptions = item.price_options ?? [];
      const priceHtml = priceOptions.length
        ? `<div class="menu-item-price-options">${priceOptions.map((option) => `<div class="menu-item-price-option"><span class="menu-item-price-label">${esc(option.label)}</span><span class="menu-item-price">${esc(euro(option.price))}</span></div>`).join("")}</div>`
        : `<p class="menu-item-price">${esc(euro(item.selling_price))}</p>`;
      return `<div class="menu-item">
        <div class="menu-item-line"><p class="menu-item-name">${esc(item.name ?? recipe?.name)}</p>${priceOptions.length ? "" : priceHtml}</div>
        ${priceOptions.length ? priceHtml : ""}
        ${description ? `<p class="menu-item-desc">${esc(description)}</p>` : ""}
        <div class="menu-item-meta">
          ${age ? `<span class="MuiChip-root">${esc(age)}</span>` : ""}
          ${notes.allergens.length ? `<span class="MuiTypography-caption"><strong>Allergene:</strong> ${esc(notes.allergens.join(", "))}</span>` : ""}
          ${notes.colorants.length ? `<span class="MuiTypography-caption"><strong>Farbstoffe:</strong> ${esc(notes.colorants.join(", "))}</span>` : ""}
        </div>
      </div>`;
    }).join('<hr class="MuiDivider-root">');
    return `<section class="menu-category MuiAccordion-root">
      <div class="menu-category-header MuiAccordionSummary-root"><div class="MuiStack-root"><svg aria-hidden="true"></svg><h3 class="menu-category-name">${esc(category)}</h3></div><span class="MuiAccordionSummary-expandIconWrapper"></span></div>
      <div class="MuiAccordionDetails-root">${items}</div>
    </section>`;
  }).join("");

  const safeCss = customCss.replace(/<\/(style|script)/gi, "");
  return `<div class="menu-theme menu-page">
    <style>@scope (.menu-theme) {${safeCss}}</style>
    <div class="menu-card MuiBox-root"><div class="MuiContainer-root">
      <header class="menu-header MuiBox-root">
        <div class="MuiBox-root"><div class="MuiBox-root">${logoUrl ? `<img src="${esc(logoUrl)}" alt="Vereinslogo">` : '<span class="preview-logo">SV</span>'}<div class="menu-club-name">${esc(clubName)} · Speisekarte</div></div><div class="menu-qr">QR-Code scannen</div></div>
        <div class="menu-title-block MuiBox-root"><div class="MuiStack-root"><h1 class="menu-title">${esc(menuName)}</h1>${menuDescription ? `<p>${esc(menuDescription)}</p>` : ""}<button class="MuiButton-root" type="button">Drucken</button></div></div>
      </header>
      <div class="MuiBox-root">${categoryHtml}</div>
      <aside class="MuiPaper-root"><strong>Hinweise:</strong> Preise inkl. MwSt. · Allergene und Farbstoffe sind gekennzeichnet.</aside>
    </div></div>
  </div>`;
}

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;background:#e8eaed;color:#1a1a1a;font-family:Arial,sans-serif}.preview-shell{padding:24px}.preview-report{max-width:1080px;margin:0 auto 20px;padding:18px 22px;border-radius:12px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.09)}.preview-report h1{margin:0 0 8px}.preview-report ul{margin:8px 0}.menu-theme{--menu-bg:#fff;--menu-text:#1a1a1a;--menu-text-muted:#666;--menu-accent:#1976d2;--menu-header-bg:#1976d2;--menu-header-text:#fff}.menu-card{max-width:1080px;margin:0 auto;background:var(--menu-bg);color:var(--menu-text);box-shadow:0 12px 40px rgba(0,0,0,.16)}.MuiContainer-root{padding:32px}.menu-header{padding:24px;background:var(--menu-header-bg);color:var(--menu-header-text)}.menu-header>.MuiBox-root:first-child{display:flex;justify-content:space-between;align-items:center}.menu-header>.MuiBox-root:first-child>.MuiBox-root{display:flex;align-items:center;gap:12px}.preview-logo{display:grid;place-items:center;width:54px;height:54px;border:2px solid currentColor;border-radius:50%;font-weight:900}.menu-title-block{text-align:center}.menu-title{font-size:54px;margin:18px 0 8px}.menu-title-block p{margin:0}.menu-title-block .MuiButton-root{margin-top:12px}.menu-header+.MuiBox-root{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}.menu-category{border:1px solid color-mix(in srgb,var(--menu-accent) 55%,transparent);background:#fff}.menu-category-header{display:flex;align-items:center;min-height:52px;padding:0 18px;background:color-mix(in srgb,var(--menu-accent) 9%,#fff)}.menu-category-header .MuiStack-root{display:flex;align-items:center}.menu-category-name{margin:0;font-size:15px}.MuiAccordionDetails-root{padding:8px 18px}.menu-item{padding:10px 0}.menu-item-line{display:flex;justify-content:space-between;gap:16px}.menu-item-name,.menu-item-price{margin:0;font-weight:800}.menu-item-price-options{display:grid;gap:3px;margin-top:5px}.menu-item-price-option{display:flex;justify-content:space-between;gap:12px}.menu-item-price-label{color:var(--menu-text-muted);font-size:13px}.menu-item-desc{margin:5px 0;color:var(--menu-text-muted);font-size:13px}.menu-item-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11px}.MuiChip-root{padding:3px 6px;background:#eee}.MuiDivider-root{border:0;border-top:1px solid #ddd}.MuiPaper-root{margin-top:18px;padding:12px;border:1px solid #ddd;font-size:12px}@media(max-width:760px){.preview-shell{padding:0}.MuiContainer-root{padding:18px}.menu-header+.MuiBox-root{grid-template-columns:1fr}.menu-title{font-size:42px}}@media print{@page{size:A4 portrait;margin:7mm}html,body{background:#fff}.preview-shell{padding:0}.preview-report{display:none}.menu-card{box-shadow:none}}
`;

export function writeMenuPreviewBundle(options: {
  card: MenuPreviewCard;
  recipes: Map<string, MenuPreviewRecipe>;
  customCss?: string;
  outDir: string;
  validation: MenuPreviewValidation;
}): { htmlPath: string; printHtmlPath: string; dataPath: string } {
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = resolve(outDir, "menu-preview.html");
  const printHtmlPath = resolve(outDir, "menu-preview-print.html");
  const dataPath = resolve(outDir, "menu-preview-data.json");
  const cardHtml = renderMenuCard(options.card, options.recipes, options.customCss ?? String(options.card.design_config?.custom_css ?? ""));
  const report = `<section class="preview-report"><h1>Speisekarten-Preview</h1><p><strong>Status:</strong> ${options.validation.valid ? "datenbereit" : "Korrekturen nötig"}</p>${options.validation.errors.length ? `<h2>Fehler</h2><ul>${options.validation.errors.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}${options.validation.warnings.length ? `<h2>Hinweise</h2><ul>${options.validation.warnings.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}</section>`;
  const doc = (body: string, extraCss = "") => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speisekarten-Preview</title><style>${BASE_CSS}${extraCss}</style></head><body>${body}</body></html>`;
  const onlineDoc = doc(`<main class="preview-shell">${report}${cardHtml}</main>`);
  // The A4 PNG is captured in screen media. Hide the action explicitly so the
  // PNG matches the PDF, where the card's print media CSS already hides it.
  const printDoc = doc(cardHtml, ".menu-title-block .MuiButton-root{display:none!important}");
  writeFileSync(htmlPath, onlineDoc, "utf-8");
  writeFileSync(printHtmlPath, printDoc, "utf-8");
  writeFileSync(dataPath, JSON.stringify({ validation: options.validation, card: options.card, recipes: Object.fromEntries(options.recipes) }, null, 2), "utf-8");
  return {
    htmlPath,
    printHtmlPath,
    dataPath,
  };
}
