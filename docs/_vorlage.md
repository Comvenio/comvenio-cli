# Vorlage für Kundenartikel

Jeder Kundenartikel folgt einer der beiden Vorlagen. `bun run check:docs` prüft Frontmatter,
Pflichtabschnitte, die englische Fassung und verbotene Inhalte; `bun run gen:docs` schreibt den
Abschnitt „Befehle und Actions“ und `docs/index.json`.

- Deutsch: `docs/<id>.md`, Englisch: `docs/en/<id>.md` (gleiche `id`, eigene `stichwoerter`).
- Fehlerartikel: `docs/fehler/<code>.md` und `docs/en/fehler/<code>.md`, Dateiname = Code klein mit
  Bindestrich (`SCOPE_REQUIRED` → `scope-required.md`), `id: fehler/<code-klein>`.
- Nicht erlaubt: Quellpfade (`src/…`), interne Dienst- und Infrastrukturnamen, interne Werkzeuge,
  echte Kennungen (UUIDs) — Beispiele verwenden Platzhalter wie `<club-id>` oder
  `11111111-1111-4111-8111-111111111111`.

## Themenartikel

```markdown
---
id: <thema>
kategorie: thema
domaenen: [<registry-domäne>, …]
stichwoerter: [<wort>, …]
---

# <Titel>

## Wozu

Ein bis drei Sätze: welche Aufgabe im Verein damit erledigt wird.

## Voraussetzungen und Rechte

Anmeldung, nötige Scopes (`comvenio login --scopes …`), nötige Vereinsrolle.

## Abläufe

### <Ablauf>

1. Schritt mit Befehl.
2. …

## Beispiele

Vollständige Befehle mit Platzhaltern.

## Befehle und Actions

<!-- gen:docs befehle -->
<!-- /gen:docs -->

## Fehler

Typische Fehlercodes dieses Themas mit Verweis auf `comvenio help fehler <CODE>`.
```

Englische Überschriften in derselben Reihenfolge: Purpose · Requirements and permissions ·
Workflows · Examples · Commands and actions · Errors.

## Fehlerartikel

```markdown
---
id: fehler/<code-klein>
kategorie: fehler
stichwoerter: [<wort>, …]
---

# <CODE> — <Meldung aus dem Katalog>

## Bedeutung

## Typische Ursachen

## Lösung

1. …
```

Englische Überschriften: Meaning · Typical causes · Solution.
