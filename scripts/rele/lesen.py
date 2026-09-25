"""Reader of a club's annual report ("ReLe <year> für HV.xls") — buchhaltung-14-04 §4.1.

    py -3 scripts/rele/lesen.py <ReLe.xls> --jahr <year> --kategorien <kategorien.json> --aus <file.json>

Reads the first sheet (income, expenses, sum rows, club result) and the sheet
"Übersicht" (statement of assets), maps the columns to the money accounts as
kategorien.json says for that year, checks every anchor and writes the
transfer file the run (uebernahme.ts) books from.

Aborts — naming sheet, row and deviation — when a row's accounts do not add up
to its total, an account column does not match the sum row, a detected row is
missing from kategorien.json, or the result does not match the statement of
assets. Deviations per account that add up to zero become the takeover
correction (§4.2b). The transfer file holds club data: it belongs with the
club, never in a repository.

Needs xlrd (py -3 -m pip install xlrd) only for reading the .xls itself.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

GELDTRANSIT = "Geldtransit"


class LeseFehler(Exception):
    """A broken anchor: the mapping or the report is wrong, nothing is written."""


def cents(wert) -> int:
    if wert in (None, ""):
        return 0
    if isinstance(wert, (int, float)):
        return int(round(wert * 100))
    raise LeseFehler(f"Kein Betrag: {wert!r}")


def euro(c: int) -> str:
    text = f"{abs(c) / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if c < 0 else ''}{text} €"


def spalte(nummer: int) -> str:
    name = ""
    nummer += 1
    while nummer:
        nummer, rest = divmod(nummer - 1, 26)
        name = chr(65 + rest) + name
    return name


def zelle(zellen: dict, adresse: str):
    return zellen.get(adresse)


def zeilen_des_blatts(zellen: dict) -> list[int]:
    return sorted({int(re.sub(r"^[A-Z]+", "", k)) for k in zellen})


def verteilen(abweichung: dict[str, int]) -> list[dict]:
    """Transfers that level `abweichung` (account → cents, sum 0).

    Deterministic (§4.2b): the account with the largest positive amount
    receives from the accounts with negative amounts, largest first; a rest
    goes to the next receiver.
    """
    geber = sorted(((k, -v) for k, v in abweichung.items() if v < 0), key=lambda x: (-x[1], x[0]))
    nehmer = sorted(((k, v) for k, v in abweichung.items() if v > 0), key=lambda x: (-x[1], x[0]))
    uebertraege = []
    gi = ni = 0
    geber = [list(g) for g in geber]
    nehmer = [list(n) for n in nehmer]
    while gi < len(geber) and ni < len(nehmer):
        betrag = min(geber[gi][1], nehmer[ni][1])
        uebertraege.append({"von": geber[gi][0], "nach": nehmer[ni][0], "betrag_cents": betrag})
        geber[gi][1] -= betrag
        nehmer[ni][1] -= betrag
        if geber[gi][1] == 0:
            gi += 1
        if nehmer[ni][1] == 0:
            ni += 1
    return uebertraege


def auswerten(blatt: dict, uebersicht: dict, cfg: dict, jahr: int, blattname: str = "Blatt 1") -> dict:
    """The transfer file of one year from the cells of both sheets (addresses like "B4")."""
    kopf = str(zelle(blatt, "B1") or "").strip()
    if kopf != cfg["kopfzeile_jahr"]:
        raise LeseFehler(f"{blattname}, Zeile 1: Kopfzeile „{kopf}“ statt „{cfg['kopfzeile_jahr']}“ — die Datei trägt nicht das Jahr {jahr}.")

    konten: dict = cfg["konten"]
    geld = [k for k, v in konten.items() if v["art"] != "IN_KIND"]
    liste = {int(k["zeile"]): k for k in cfg["kategorien"]}
    summen = {int(cfg["summenzeile"][s]) for s in ("E", "A")}

    seite = "E"
    gefunden: list[dict] = []
    for r in zeilen_des_blatts(blatt):
        text = str(zelle(blatt, f"A{r}") or "").strip()
        if text.startswith("Ausgaben") and r > 1:
            seite = "A"
            continue
        b = zelle(blatt, f"B{r}")
        if not text or not isinstance(b, (int, float)) or r in summen or text.startswith("Vereinsergebnis"):
            continue
        eintrag = liste.get(r)
        if eintrag is None:
            raise LeseFehler(f"{blattname}, Zeile {r}: „{text}“ ({euro(cents(b))}) fehlt in kategorien.json.")
        if eintrag["text"].strip() != text:
            raise LeseFehler(f"{blattname}, Zeile {r}: kategorien.json nennt „{eintrag['text']}“, der Bericht „{text}“.")
        betraege: dict[str, int] = {}
        teile: dict[str, list[int]] = {}
        for konto, k in konten.items():
            werte = [cents(zelle(blatt, f"{c}{r}")) for c in k["spalten"][seite]]
            if any(werte):
                betraege[konto] = sum(werte)
                teile[konto] = [w for w in werte if w]
        zeilensumme = sum(betraege.values())
        if abs(zeilensumme - cents(b)) > 1:
            raise LeseFehler(f"{blattname}, Zeile {r}: „{text}“ — Konten ergeben {euro(zeilensumme)}, Spalte B {euro(cents(b))}.")
        # `name` names the position where the line itself is no name (a note row
        # carrying the amount of the line above); the line text is still checked.
        gefunden.append({"zeile": r, "text": eintrag.get("name") or text, "seite": seite, "rubrik": eintrag["rubrik"],
                         "sphaere": eintrag.get("sphaere"), "betraege": betraege, "teile": teile, "b": cents(b)})
    fehlend = sorted(set(liste) - {g["zeile"] for g in gefunden})
    if fehlend:
        raise LeseFehler(f"{blattname}: kategorien.json nennt Zeilen, die keine Kategoriezeile sind: {fehlend}.")

    # Anchor: every account column of the sum rows.
    for s in ("E", "A"):
        zeilen = [g for g in gefunden if g["seite"] == s]
        for pruef, adresse in cfg.get("summen", {}).get(s, {}).items():
            soll = cents(zelle(blatt, adresse))
            ist = sum(g["b"] for g in zeilen) if pruef == "B" else sum(g["betraege"].get(pruef, 0) for g in zeilen)
            if abs(ist - soll) > 1:
                raise LeseFehler(f"{blattname}, Zelle {adresse}: {'Summe' if pruef == 'B' else pruef} {euro(soll)}, die Kategoriezeilen ergeben {euro(ist)}.")

    einnahmen = sum(g["b"] for g in gefunden if g["seite"] == "E")
    ausgaben = sum(g["b"] for g in gefunden if g["seite"] == "A")
    ergebnis = einnahmen - ausgaben
    ergebnis_zelle = cfg.get("ergebniszelle")
    if ergebnis_zelle and abs(cents(zelle(blatt, ergebnis_zelle)) - ergebnis) > 1:
        raise LeseFehler(f"{blattname}, Zelle {ergebnis_zelle}: Vereinsergebnis {euro(cents(zelle(blatt, ergebnis_zelle)))}, Einnahmen minus Ausgaben {euro(ergebnis)}.")

    # Statement of assets: opening and closing balance of every money account.
    ueb = cfg["uebersicht"]
    bestand: dict[str, dict] = {}
    namen = {r: str(zelle(uebersicht, f"A{r}") or "").strip() for r in zeilen_des_blatts(uebersicht)}
    for konto in geld:
        muster = konten[konto]["uebersicht"]
        treffer = [r for r, n in namen.items() if n.startswith(muster)]
        if len(treffer) != 1:
            raise LeseFehler(f"Übersicht: „{muster}“ ({konto}) steht {len(treffer)}-mal da, erwartet einmal.")
        r = treffer[0]
        bestand[konto] = {"anfang_cents": cents(zelle(uebersicht, f"{ueb['anfang']}{r}")),
                          "ende_cents": cents(zelle(uebersicht, f"{ueb['ende']}{r}"))}
    sachwerte = [k for k, v in konten.items() if v["art"] == "IN_KIND"]
    sach_saldo = sum(sum(g["betraege"].get(k, 0) * (1 if g["seite"] == "E" else -1) for g in gefunden) for k in sachwerte)
    differenz = sum(b["ende_cents"] - b["anfang_cents"] for b in bestand.values())
    if abs(differenz + sach_saldo - ergebnis) > 1:
        raise LeseFehler(f"Übersicht: Differenz der Geldbestände {euro(differenz)} (Sachwerte {euro(sach_saldo)}) ist nicht das Vereinsergebnis {euro(ergebnis)}.")

    # Money in transit: net per account, transfers from givers to receivers.
    transit_netto: dict[str, int] = {}
    wechselgeld = []
    for g in (g for g in gefunden if g["rubrik"] == GELDTRANSIT):
        vz = 1 if g["seite"] == "E" else -1
        for konto, teile in g["teile"].items():
            transit_netto[konto] = transit_netto.get(konto, 0) + vz * sum(teile)
            plus = sum(t for t in teile if t * vz > 0)
            minus = -sum(t for t in teile if t * vz < 0)
            if plus and minus:
                # A move between the sub columns of one account (change money):
                # it never leaves the account, so nothing is booked (§4.2b).
                wechselgeld.append({"konto": konto, "zeile": g["zeile"], "betrag_cents": min(abs(plus), abs(minus))})
    if sum(transit_netto.values()) != 0:
        raise LeseFehler(f"{blattname}: Geldtransit ergibt {euro(sum(transit_netto.values()))} statt 0,00 €.")
    transit = verteilen({k: v for k, v in transit_netto.items() if v})

    # Takeover correction: movement per account against the statement of assets.
    abweichung: dict[str, int] = {}
    for konto in geld:
        ist = sum(g["betraege"].get(konto, 0) * (1 if g["seite"] == "E" else -1) for g in gefunden)
        soll = bestand[konto]["ende_cents"] - bestand[konto]["anfang_cents"]
        if soll != ist:
            abweichung[konto] = soll - ist
    if sum(abweichung.values()) != 0:
        teile = ", ".join(f"{k} {euro(v)}" for k, v in abweichung.items())
        raise LeseFehler(f"Übersicht: Die Abweichungen je Konto ergeben zusammen {euro(sum(abweichung.values()))} statt 0,00 € ({teile}).")

    return {
        "jahr": jahr,
        "quelle": {"blatt": blattname, "kopfzeile": kopf},
        "konten": [{"name": k, "art": konten[k]["art"], "standard": bool(konten[k].get("standard")),
                    **(bestand.get(k) or {"anfang_cents": 0, "ende_cents": None})} for k in konten],
        "kategorien": [{"zeile": g["zeile"], "text": g["text"], "seite": g["seite"], "rubrik": g["rubrik"],
                        "sphaere": g["sphaere"], "betraege": g["betraege"]}
                       for g in gefunden if g["rubrik"] != GELDTRANSIT],
        "transit": transit,
        "wechselgeld": wechselgeld,
        "korrektur": {"abweichung": abweichung, "uebertraege": verteilen(abweichung)},
        "stichtagsdifferenzen": cfg.get("stichtagsdifferenzen", []),
        "einnahmen_cents": einnahmen,
        "ausgaben_cents": ausgaben,
        "ergebnis_cents": ergebnis,
    }


def zellen_aus(blatt) -> dict:
    out = {}
    for r in range(blatt.nrows):
        for c in range(blatt.ncols):
            wert = blatt.cell_value(r, c)
            if wert not in ("", None):
                out[f"{spalte(c)}{r + 1}"] = wert
    return out


def lesen(pfad: Path, jahr: int, kategorien: dict) -> dict:
    import xlrd  # only needed for the file itself

    cfg = kategorien.get(str(jahr))
    if cfg is None:
        raise LeseFehler(f"kategorien.json kennt das Jahr {jahr} nicht.")
    buch = xlrd.open_workbook(str(pfad))
    erstes = buch.sheet_by_index(0)
    ueb = buch.sheet_by_name("Übersicht")
    ergebnis = auswerten(zellen_aus(erstes), zellen_aus(ueb), cfg, jahr, erstes.name)
    ergebnis["quelle"]["datei"] = pfad.name
    return ergebnis


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("datei", type=Path)
    parser.add_argument("--jahr", type=int, required=True)
    parser.add_argument("--kategorien", type=Path, required=True)
    parser.add_argument("--aus", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        daten = lesen(args.datei, args.jahr, json.loads(args.kategorien.read_text(encoding="utf-8")))
    except LeseFehler as fehler:
        print(f"Abbruch: {fehler}", file=sys.stderr)
        return 1
    args.aus.write_text(json.dumps(daten, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{args.jahr}: Einnahmen {euro(daten['einnahmen_cents'])} · Ausgaben {euro(daten['ausgaben_cents'])} · "
          f"Ergebnis {euro(daten['ergebnis_cents'])}")
    for u in daten["transit"]:
        print(f"  Geldtransit {u['von']} → {u['nach']} {euro(u['betrag_cents'])}")
    for u in daten["korrektur"]["uebertraege"]:
        print(f"  Übernahmekorrektur {u['von']} → {u['nach']} {euro(u['betrag_cents'])}")
    print(f"→ {args.aus}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
