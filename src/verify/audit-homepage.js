// Der Homepage-DOM-Audit — als TEXT ausgeliefert, nicht als Template-Literal.
//
// **Warum diese Datei existiert.** Bis zum 2026-08-31 stand dieser Code als
// Template-Literal in `commands/verify.ts`. Ein Template-Literal wertet
// Escape-Sequenzen aus, und die Regexe hier tragen welche: `/\s+/g` wurde zu
// `/s+/g` (ein anderer Ausdruck), und `/\/+$/` wurde zu `//+$/` — also zu
// einem ZEILENKOMMENTAR, der den Rest der Zeile frass.
//
// Gemessen auf dem Produktionsweg: Der Text, den die Anwendung sendete, war
// 7418 Zeichen lang und **kein gueltiges JavaScript**. `playwright-cli`
// antwortete mit `Passed function is not well-serializable!` — und mit
// **Exit 0**, weshalb es niemand bemerkte. Der Homepage-Audit hat damit nie
// funktioniert.
//
// Ein Dateiinhalt durchlaeuft keine Escape-Auswertung. Der Browser bekommt
// genau diese Bytes.
//
// **Zwei Bedingungen bleiben:** kein `//`-Kommentar unterhalb der Marke (der
// Text wird mit `.replace(/\s+/g, ' ')` komprimiert, ein Zeilenkommentar
// verschluckt den Rest der Zeile), und keine Referenz nach draussen ausser
// `window.__auditHelfer`.
//
// Die Laenge haelt `tests/verify-audit-regeln.test.ts` fest: Der Aufruf geht
// als Kommandozeilen-Argument durch `cmd.exe`, Grenze rund 7950 Zeichen.

// **Zwei Dinge, die im Rumpf nicht stehen duerfen und deshalb hier stehen:**
//
// 1. `window.__auditHelfer` wird GEPRUEFT, nicht angenommen. Die untersuchte
//    Seite kann die Eigenschaft selbst definieren, einfrieren oder
//    ueberschreiben — `verify url` nimmt beliebige Adressen entgegen. Ohne
//    die Pruefung rechnete der Audit mit fremden Funktionen und meldete
//    still falsche Ergebnisse. Der Wurf landet als Infrastrukturfehler im
//    Aufrufer, nicht als Befund ueber die Seite.
//
// 2. `isExcluded` erkennt `visibility:hidden`, `collapse` und `opacity:0`,
//    nicht nur `display:none`. Alle drei nehmen einem Element jede
//    Sichtbarkeit, waehrend seine Geometrie positiv bleibt — `hasBox` liess
//    solchen Text durch, und ein `<main>` mit ausschliesslich verstecktem
//    Inhalt galt als gefuellt.
//
// Beides fand die dritte Fremdvalidierung.
//
// **Jedes Zeichen unter der Marke geht in die Kommandozeile.** Erklaerungen
// gehoeren deshalb hierher, nicht in den Rumpf: 655 Zeichen Blockkommentar
// haben den Text am 2026-08-31 ueber die Grenze geschoben.

/* AUDIT-HOMEPAGE */
() => {
  const failures = [];
  const unverifiable = [];
  let checkedTexts = 0;
  const seen = new Set();
    const h = window.__auditHelfer;
  const NAMEN = ['toRGB', 'contrastRatio', 'istGrosseSchrift', 'kontrastSchwelle',
    'hasBox', 'isExcluded', 'sichtbarerText', 'effectiveBackground'];
  if (!h || typeof h !== 'object' || NAMEN.some((n) => typeof h[n] !== 'function')) {
    throw new Error('__auditHelfer fehlt oder wurde von der Seite ueberschrieben');
  }
  const { toRGB, contrastRatio, istGrosseSchrift, kontrastSchwelle,
    excludedSelector, hasBox, isExcluded, sichtbarerText, effectiveBackground } = h;
        const root = document.querySelector('main') || document.querySelector('.pub-site-root') || document.body;
    const rootText = sichtbarerText(root);
  const visibleMedia = [...root.querySelectorAll('img,video,canvas')].some((element) => !isExcluded(element) && hasBox(element));
  if (rootText.length < 20 && !visibleMedia) {
    failures.push({ kind: 'empty_main', message: 'Die sichtbare Hauptregion enthaelt keinen ausreichenden Inhalt.', details: { text_length: rootText.length } });
  }
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (overflow > 1) {
    failures.push({ kind: 'horizontal_overflow', message: 'Die Seite laeuft horizontal aus dem Viewport.', details: { overflow_px: overflow } });
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    const element = node.parentElement;
    if (!element || seen.has(element) || isExcluded(element) || !hasBox(element)) continue;
    seen.add(element);
    const style = getComputedStyle(element);
    let opacity = 1;
    let current = element;
    while (current) {
      opacity *= Number.parseFloat(getComputedStyle(current).opacity || '1');
      current = current.parentElement;
    }
    if (style.visibility === 'hidden' || opacity <= 0.01) {
      failures.push({
        kind: 'invisible_text',
        message: 'Semantischer Text ist nach Scroll-Settling unsichtbar.',
        details: { text: text.slice(0, 80), visibility: style.visibility, opacity: Math.round(opacity * 1000) / 1000 },
      });
      continue;
    }
    const foreground = toRGB(style.color);
    if (!foreground) continue;
    const background = effectiveBackground(element);
    if (!background) {
      unverifiable.push({
        kind: 'unverifiable_background',
        message: 'Text liegt auf einem Bild-, Video- oder Gradient-Hintergrund.',
        details: { text: text.slice(0, 80) },
      });
      continue;
    }
    const ratio = contrastRatio(foreground, background);
    const size = Number.parseFloat(style.fontSize);
    const weight = Number.parseInt(style.fontWeight, 10) || 400;
    const large = istGrosseSchrift(size, weight);
    checkedTexts += 1;
    if (ratio < kontrastSchwelle(large)) {
      failures.push({
        kind: 'contrast',
        message: 'Der Textkontrast unterschreitet WCAG AA.',
        details: { text: text.slice(0, 80), ratio: Math.round(ratio * 100) / 100, font_size: size, font_weight: weight },
      });
    }
  }
  const legalFooter = document.querySelector('[data-public-legal-footer]');
  const legalFooterStyle = legalFooter ? getComputedStyle(legalFooter) : null;
  const legalFooterVisible = !!legalFooter && hasBox(legalFooter) &&
    legalFooterStyle?.display !== 'none' && legalFooterStyle?.visibility !== 'hidden' &&
    Number.parseFloat(legalFooterStyle?.opacity || '1') > 0.01;
  if (!legalFooterVisible) {
    failures.push({
      kind: 'missing_legal_footer',
      message: 'Der unveraenderbare Rechtsfooter fehlt.',
    });
  } else {
    const requiredLinks = {
      imprint: null,
      privacy: 'https://www.comvenio.app/datenschutz',
      terms: 'https://www.comvenio.app/agb',
      powered_by: 'https://www.comvenio.app',
    };
    for (const [key, expected] of Object.entries(requiredLinks)) {
      const link = legalFooter.querySelector('[data-public-legal-link="' + key + '"]');
      const linkStyle = link ? getComputedStyle(link) : null;
      const linkVisible = !!link && hasBox(link) &&
        linkStyle?.display !== 'none' && linkStyle?.visibility !== 'hidden' &&
        linkStyle?.pointerEvents !== 'none' &&
        Number.parseFloat(linkStyle?.opacity || '1') > 0.01;
      if (!linkVisible) {
        failures.push({
          kind: 'invalid_legal_footer_link',
          message: 'Pflichtlink im Rechtsfooter fehlt oder ist nicht bedienbar.',
          details: { link: key },
        });
        continue;
      }
      const href = new URL(link.getAttribute('href') || '', location.href);
      const normalized = href.origin + href.pathname.replace(/\/+$/, '');
      const valid = key === 'imprint'
        ? href.pathname.replace(/\/+$/, '') === '/impressum' || href.searchParams.get('page') === 'impressum'
        : normalized === expected;
      if (!valid) {
        failures.push({
          kind: 'invalid_legal_footer_link',
          message: 'Pflichtlink im Rechtsfooter zeigt auf ein falsches Ziel.',
          details: { link: key, href: href.toString(), expected },
        });
      }
      link.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = link.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
        Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
      );
      if (!topElement || (topElement !== link && !link.contains(topElement))) {
        failures.push({
          kind: 'invalid_legal_footer_link',
          message: 'Pflichtlink im Rechtsfooter wird von einem anderen Element verdeckt.',
          details: {
            link: key,
            occluded_by: topElement ? topElement.tagName.toLowerCase() : null,
          },
        });
      }
    }
  }

  const imprintRequested =
    location.pathname.replace(/\/+$/, '') === '/impressum' ||
    new URLSearchParams(location.search).get('page') === 'impressum';
  if (imprintRequested) {
    const imprint = document.querySelector('[data-public-imprint-page]');
    if (!imprint) {
      failures.push({
        kind: 'imprint_unavailable',
        message: 'Die separate oeffentliche Impressum-Seite ist nicht verfuegbar.',
      });
    } else {
      const imprintStatus = imprint.getAttribute('data-public-imprint-status');
      if (imprintStatus !== 'ready') {
        failures.push({
          kind: 'imprint_unavailable',
          message: 'Die Vereinsdaten des Impressums konnten nicht geladen werden.',
          details: { status: imprintStatus },
        });
      }
      if (imprint.getAttribute('data-public-imprint-contact') !== 'present') {
        failures.push({
          kind: 'invalid_imprint_content',
          message: 'Im Impressum fehlen die oeffentlichen Kontaktdaten des Vereins.',
        });
      }
      const imprintText = (imprint.textContent || '').replace(/\s+/g, ' ').trim();
      if (!imprintText.includes('Impressum') || !imprintText.includes('Verantwortlich für die Inhalte')) {
        failures.push({
          kind: 'invalid_imprint_content',
          message: 'Das Impressum enthaelt nicht den Pflichtinhalt zur Vereinsverantwortung.',
          details: { text_length: imprintText.length },
        });
      }
    }
  }
  return JSON.stringify({ checked_texts: checkedTexts, failures, unverifiable });
}
