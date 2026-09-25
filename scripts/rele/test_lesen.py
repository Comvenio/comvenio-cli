"""Reader of the annual report (buchhaltung-14-04) against a synthetic year 2031.

    py -3 -m unittest discover -s scripts/rele -p "test_*.py"

No club data: the cells are made up, the mapping is kategorien.beispiel.json.
"""
import copy
import json
import unittest
from pathlib import Path

from lesen import LeseFehler, auswerten, verteilen

CFG = json.loads((Path(__file__).parent / "kategorien.beispiel.json").read_text(encoding="utf-8"))["2031"]

BLATT = {
    "A1": "Einnahmen:", "B1": "1.1.-31.12.2031",
    "A3": "Mitgliedsbeiträge", "B3": 1000, "G3": 1000,
    "A4": "Sommerfest", "B4": 500, "D4": 500,
    "A5": "Geldtransit", "B5": 0, "D5": 100, "E5": -400, "G5": 300,
    "A6": "Zinsen", "B6": 10, "M6": 10,
    "A7": "Sachspenden", "B7": 50, "O7": 50,
    "B8": 1560, "K8": 1300,
    "E9": 200,
    "A10": "Ausgaben", "B10": "1.1.-31.12.2031",
    "A11": "Wareneinkauf Sommerfest", "B11": 200, "D11": 150, "G11": 50,
    "A12": "Verbandsabgaben", "B12": 300, "H12": 300,
    "A13": "Verbrauch Sachspenden", "B13": 50, "O13": 50,
    "B14": 550, "N14": 350,
    "E15": 150,
    "A16": "Vereinsergebnis 2031", "B16": 1010,
}
# Opening in D, closing in B — as in the report of that year.
UEBERSICHT = {
    "A4": "Vermögensübersicht", "B4": "31.12.2031", "D4": "31.12.2030",
    "A5": "Kasse (Barbestand)", "B5": 150, "D5": 100,
    "A6": "Girokonto", "B6": 2950, "D6": 2000,
    "A7": "Tagesgeld", "B7": 510, "D7": 500,
}


def lauf(blatt=None, uebersicht=None, cfg=None):
    return auswerten(blatt or BLATT, uebersicht or UEBERSICHT, cfg or CFG, 2031)


class Leser(unittest.TestCase):
    def test_sums_result_and_statement_agree(self):
        daten = lauf()
        self.assertEqual((daten["einnahmen_cents"], daten["ausgaben_cents"], daten["ergebnis_cents"]), (156000, 55000, 101000))
        self.assertEqual(daten["korrektur"], {"abweichung": {}, "uebertraege": []})
        konten = {k["name"]: k for k in daten["konten"]}
        self.assertEqual((konten["Girokonto"]["anfang_cents"], konten["Girokonto"]["ende_cents"]), (200000, 295000))
        self.assertIsNone(konten["Sachwerte"]["ende_cents"])
        self.assertNotIn("Geldtransit", [k["text"] for k in daten["kategorien"]])

    def test_money_in_transit_becomes_a_transfer_and_change_money_is_only_named(self):
        # TC-07 in small: the cash box gives 3 € to the bank; 1 € moved between its own sub columns.
        daten = lauf()
        self.assertEqual(daten["transit"], [{"von": "Barkasse", "nach": "Girokonto", "betrag_cents": 30000}])
        self.assertEqual(daten["wechselgeld"], [{"konto": "Barkasse", "zeile": 5, "betrag_cents": 10000}])

    def test_tc02_an_account_column_that_misses_the_sum_row_aborts(self):
        blatt = {**BLATT, "K8": 1299}
        with self.assertRaisesRegex(LeseFehler, r"Zelle K8: Girokonto 1\.299,00 €, die Kategoriezeilen ergeben 1\.300,00 €"):
            lauf(blatt)

    def test_tc03_the_year_is_checked_at_the_header(self):
        with self.assertRaisesRegex(LeseFehler, r"Zeile 1: Kopfzeile „1\.1\.-31\.12\.2030“"):
            lauf({**BLATT, "B1": "1.1.-31.12.2030"})

    def test_a_row_whose_accounts_miss_its_total_aborts(self):
        with self.assertRaisesRegex(LeseFehler, r"Zeile 4: „Sommerfest“ — Konten ergeben 400,00 €, Spalte B 500,00 €"):
            lauf({**BLATT, "D4": 400})

    def test_a_row_missing_from_the_mapping_aborts(self):
        cfg = copy.deepcopy(CFG)
        cfg["kategorien"] = [k for k in cfg["kategorien"] if k["zeile"] != 12]
        with self.assertRaisesRegex(LeseFehler, r"Zeile 12: „Verbandsabgaben“ \(300,00 €\) fehlt in kategorien\.json"):
            lauf(cfg=cfg)

    def test_tc10_deviations_that_cancel_out_become_the_takeover_correction(self):
        uebersicht = {**UEBERSICHT, "B5": 120, "B6": 2980}
        daten = lauf(uebersicht=uebersicht)
        self.assertEqual(daten["korrektur"]["abweichung"], {"Barkasse": -3000, "Girokonto": 3000})
        self.assertEqual(daten["korrektur"]["uebertraege"], [{"von": "Barkasse", "nach": "Girokonto", "betrag_cents": 3000}])

    def test_tc10_one_cent_off_in_the_statement_aborts(self):
        with self.assertRaisesRegex(LeseFehler, r"Abweichungen je Konto ergeben zusammen 0,01 € statt 0,00 € \(Barkasse -30,00 €, Girokonto 30,01 €\)"):
            lauf(uebersicht={**UEBERSICHT, "B5": 120, "B6": 2980.01})

    def test_a_name_replaces_the_line_text_as_position_name_but_the_text_is_still_checked(self):
        cfg = copy.deepcopy(CFG)
        next(k for k in cfg["kategorien"] if k["zeile"] == 12)["name"] = "Verband"
        self.assertIn("Verband", [k["text"] for k in lauf(cfg=cfg)["kategorien"]])
        with self.assertRaisesRegex(LeseFehler, r"Zeile 12: kategorien\.json nennt „Verbandsbeitrag“"):
            next(k for k in cfg["kategorien"] if k["zeile"] == 12)["text"] = "Verbandsbeitrag"
            lauf(cfg=cfg)

    def test_distribution_is_largest_first(self):
        # The 2024 case of §4.2b.
        self.assertEqual(
            verteilen({"Barkasse": -469553, "Girokonto": 472481, "Raiba Termingeld": -2676, "Sparkasse Termingeld": -252}),
            [{"von": "Barkasse", "nach": "Girokonto", "betrag_cents": 469553},
             {"von": "Raiba Termingeld", "nach": "Girokonto", "betrag_cents": 2676},
             {"von": "Sparkasse Termingeld", "nach": "Girokonto", "betrag_cents": 252}],
        )
        self.assertEqual(
            verteilen({"Barkasse": -1000, "Raiba Termingeld": 1338, "Sparkasse Termingeld": -338}),
            [{"von": "Barkasse", "nach": "Raiba Termingeld", "betrag_cents": 1000},
             {"von": "Sparkasse Termingeld", "nach": "Raiba Termingeld", "betrag_cents": 338}],
        )


if __name__ == "__main__":
    unittest.main()
