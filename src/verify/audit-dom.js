// Die DOM-Helfer der Audits — als TEXT, in einem eigenen `eval`-Aufruf.
//
// **Warum sie hier stehen.** Der Skripttext geht als Kommandozeilen-Argument
// durch `cmd.exe`; die Grenze liegt gemessen bei rund 7950 Zeichen. Der
// Homepage-Audit lag am 2026-08-31 bei 7824 und damit 102 Zeichen darunter —
// zu wenig, um die naechste Regel zu tragen. Diese fuenf Bausteine nehmen ihm
// 1279 Zeichen ab.
//
// Sie gehen zusammen mit der Farbrechnung in EINER IIFE an die Seite;
// `effectiveBackground` braucht `toRGB` und findet es dort im selben Scope.
//
// **Bedingungen:** kein `//`-Kommentar unterhalb der Marke (der Text wird zu
// einer Zeile komprimiert), und keine Referenz nach draussen.

/* AUDIT-DOM */
const excludedSelector = '[aria-hidden="true"],[hidden],.sr-only,.screen-reader-text,.visually-hidden,.Mui-visuallyHidden';
const hasBox = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
const isExcluded = (element) => {
    if (element.closest(excludedSelector)) return true;
    let current = element;
    while (current) {
      const st = getComputedStyle(current);
      if (st.display === 'none') return true;
      if (st.visibility === 'hidden' || st.visibility === 'collapse') return true;
      if (parseFloat(st.opacity) === 0) return true;
      current = current.parentElement;
    }
    return false;
  };
const sichtbarerText = (w) => {
    const g = document.createTreeWalker(w, NodeFilter.SHOW_TEXT), s = [];
    while (g.nextNode()) {
      const n = g.currentNode, e = n.parentElement;
      if (e && !isExcluded(e) && hasBox(e)) s.push(n.textContent || '');
    }
    return s.join('').replace(/\s+/g, ' ').trim();
  };
const effectiveBackground = (element) => {
    const schichten = [];
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      const color = toRGB(style.backgroundColor);
      if (color && color.a > 0.001) {
        if (color.a >= 0.999) {
          let unten = color;
          for (let i = schichten.length - 1; i >= 0; i--) unten = ueberlagern(schichten[i], unten);
          return unten;
        }
        schichten.push(color);
      }
      current = current.parentElement;
    }
    let unten = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = schichten.length - 1; i >= 0; i--) unten = ueberlagern(schichten[i], unten);
    return unten;
  };
