// Probelauf (comvenio-cli-doku 09): catalog, sandbox, scoring, report and
// repeatability — against the committed articles and synthetic transcripts in
// the stream-json format of `claude -p`. No session runs here (09 DC-7).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Aufgabe,
  type Bericht,
  type Katalog,
  BEREICHE,
  baueKatalog,
  bewertbar,
  bekannteActions,
  berichtMarkdown,
  claudeArgumente,
  cliHuelle,
  faqPaare,
  genannt,
  gruppiere,
  imSandbox,
  istStabil,
  kernaussagen,
  klickAussagen,
  leseTranskript,
  luecken,
  menueSchritte,
  prompt,
  standardSatz,
  vergleiche,
  werteAus,
} from "../scripts/probelauf.ts";

const ROOT = join(import.meta.dir, "..");
const katalog = baueKatalog(ROOT);
const actions = bekannteActions(ROOT);

function aufgabe(id: string): Aufgabe {
  const gefunden = katalog.aufgaben.find((eintrag) => eintrag.id === id);
  if (!gefunden) throw new Error(`Aufgabe ${id} fehlt im Katalog`);
  return gefunden;
}

type Aufruf = { name: string; input: Record<string, unknown>; ergebnis?: string; fehler?: boolean; abgelehnt?: boolean; ohneAntwort?: boolean };

/** Builds a stream-json transcript: init, one tool call/result per entry, final result. */
function transkript(aufrufe: Aufruf[], antwort: string, mcpStatus = "connected"): string {
  const zeilen: unknown[] = [{ type: "system", subtype: "init", model: "claude-sonnet", mcp_servers: [{ name: "comvenio", status: mcpStatus }] }];
  aufrufe.forEach((aufruf, index) => {
    const id = `toolu_${index}`;
    zeilen.push({ type: "assistant", message: { content: [{ type: "tool_use", id, name: aufruf.name, input: aufruf.input }] } });
    if (!aufruf.ohneAntwort) zeilen.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: aufruf.ergebnis ?? "ok", is_error: aufruf.fehler ?? false }] } });
  });
  const denials = aufrufe.flatMap((aufruf, index) => (aufruf.abgelehnt ? [{ tool_name: aufruf.name, tool_use_id: `toolu_${index}`, tool_input: aufruf.input }] : []));
  zeilen.push({ type: "result", subtype: "success", result: antwort, duration_ms: 4200, total_cost_usd: 0.03, permission_denials: denials });
  return zeilen.map((zeile) => JSON.stringify(zeile)).join("\n");
}

const bash = (command: string, extra: Partial<Aufruf> = {}): Aufruf => ({ name: "Bash", input: { command }, ...extra });

describe("Katalog (AK-F-01)", () => {
  test("jeder Bereich hat Bau- und Fachfragen; Web-App fehlt nur, wo 08 keine Führung liefert", () => {
    for (const bereich of BEREICHE) {
      expect(katalog.aufgaben.some((eintrag) => eintrag.bereich === bereich && eintrag.klasse === "bau")).toBe(true);
      expect(katalog.aufgaben.some((eintrag) => eintrag.bereich === bereich && eintrag.klasse === "fachfrage")).toBe(true);
      const web = katalog.aufgaben.some((eintrag) => eintrag.bereich === bereich && eintrag.klasse === "web-app");
      const na = katalog.nicht_anwendbar.some((eintrag) => eintrag.bereich === bereich && eintrag.klasse === "web-app");
      expect(web !== na).toBe(true);
    }
  });

  test("Aufgaben-IDs sind eindeutig und der Standardsatz nimmt je Bereich und Klasse genau eine", () => {
    const ids = katalog.aufgaben.map((eintrag) => eintrag.id);
    expect(new Set(ids).size).toBe(ids.length);
    const satz = standardSatz(katalog);
    const gruppen = new Set(katalog.aufgaben.filter(bewertbar).map((eintrag) => `${eintrag.bereich}/${eintrag.klasse}`));
    expect(satz).toHaveLength(gruppen.size);
    // A task without key statements (or a build task without commands) would only cost a session.
    expect(satz.every(bewertbar)).toBe(true);
    expect(katalog.aufgaben.some((eintrag) => !bewertbar(eintrag))).toBe(true);
    expect(standardSatz(baueKatalog(ROOT)).map((eintrag) => eintrag.id)).toEqual(satz.map((eintrag) => eintrag.id));
  });

  test("keine Frage verrät ihre Antwort", () => {
    for (const eintrag of katalog.aufgaben) {
      for (const aussage of eintrag.kernaussagen) {
        if (/^(Ja|Nein)$/u.test(aussage)) continue;
        expect({ id: eintrag.id, aussage, drin: eintrag.frage.includes(aussage) }).toEqual({ id: eintrag.id, aussage, drin: false });
      }
    }
  });

  test("FAQ-Paare und Kernaussagen: Code-Spannen und Ja/Nein, nichts aus der Frage", () => {
    const body = "## Häufige Fragen\n\n**Warum lehnt die CLI `45.50` ab?**\nBeträge sind Cent. Richtig ist `4550`, sonst `VALIDATION_FAILED`.\n\n**Ist X ein Y?**\nNein. `cai.a.01.b` ist etwas anderes.\n\n## Befehle und Actions\n";
    const paare = faqPaare(body);
    expect(paare.map((paar) => paar.frage)).toEqual(["Warum lehnt die CLI `45.50` ab?", "Ist X ein Y?"]);
    expect(kernaussagen(paare[0]!.frage, paare[0]!.antwort)).toEqual(["4550", "VALIDATION_FAILED"]);
    expect(kernaussagen(paare[1]!.frage, paare[1]!.antwort)).toEqual(["Nein", "cai.a.01.b"]);
  });

  test("Menüschritte ohne „Web-App“ und ohne den Titel selbst", () => {
    expect(menueSchritte("Finance Hub → Reiter Bereichsbudget", "Bereichsbudget")).toEqual(["Finance Hub", "Reiter Bereichsbudget"]);
    expect(menueSchritte("Web-App → Homepage-Designer", "Homepage-Designer")).toEqual([]);
    expect(menueSchritte("Finance Hub → Buchhaltung", "Buchhaltungs-Tab")).toEqual(["Finance Hub"]);
  });

  test("Klicks: Beschriftung statt Platzhalter, sonst der Auslöser ohne Verb, nichts aus dem Titel", () => {
    const aktion = (ausloeser: string) => ({ element: "e", ausloeser, wirkung: "w" });
    expect(klickAussagen([aktion("Klick auf „<Jahr>“"), aktion("Klick auf „Posten“ im Kopf"), aktion("Klick auf eine Bereichskarte")], "Sicht")).toEqual(["Posten", "Bereichskarte"]);
    expect(klickAussagen([aktion("Klick auf „Galerie“")], "Abschnitt Galerie")).toEqual([]);
  });
});

describe("Sandbox (09 §4.1)", () => {
  test("nur Bash und WebFetch, keine Einstellungen des Arbeitsplatzes, confirm gesperrt", () => {
    const argumente = claudeArgumente({ prompt: "x", modell: "sonnet", mcpConfig: "/tmp/mcp.json", maxTurns: 5 });
    expect(argumente[argumente.indexOf("--tools") + 1]).toBe("Bash,WebFetch");
    expect(argumente[argumente.indexOf("--setting-sources") + 1]).toBe("");
    expect(argumente).toContain("--strict-mcp-config");
    expect(argumente[argumente.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(argumente[argumente.indexOf("--disallowedTools") + 1]).toBe("Bash(comvenio action confirm:*)");
    expect(argumente.filter((argument) => argument.startsWith("Bash(")).every((argument) => argument.startsWith("Bash(comvenio "))).toBe(true);
  });

  test("der Prompt verbietet confirm und lokale Dateien und nennt die Umgebung", () => {
    const text = prompt(aufgabe("finance.bau.budgetposten"), "dev");
    expect(text).toContain("niemals `comvenio action confirm`");
    expect(text).toContain("lies keine lokalen Dateien");
    expect(text).toContain("Umgebung dev");
  });
});

describe("Messung (09 §4.3)", () => {
  test("TC-01: Homepage-Bauaufgabe bis zur Vorschau gelöst, ohne Sandbox-Verstoß", () => {
    const roh = transkript(
      [
        bash("comvenio help homepage"),
        bash("comvenio action list"),
        bash(`comvenio action call cai.homepage.01.preview --input '{"sections":[{"widget":"hero"}]}'`, { ergebnis: "preview_id: 1" }),
      ],
      "Die Vorschau steht.",
    );
    const ergebnis = werteAus(aufgabe("homepage.bau.hero-vorschau"), leseTranskript(roh), actions);
    expect(ergebnis.geloest).toEqual({ status: "DERIVED", wert: "ja" });
    expect(ergebnis.nachschlaege.wert).toBe(2);
    expect(ergebnis.sandbox_verstoesse.wert).toEqual([]);
    expect(ergebnis.confirm_versuche.wert).toBe(0);
    expect(ergebnis.dauer_ms).toEqual({ status: "DERIVED", wert: 4200 });
  });

  test("TC-01: ein Lesezugriff auf Quellcode ist ein Sandbox-Verstoß, ein abgelehnter Versuch nicht", () => {
    const roh = transkript(
      [
        { name: "Read", input: { file_path: "/repo/comvenio-cli/src/index.ts" }, ergebnis: "…" },
        bash("cat ~/comvenio-cli/docs/homepage.md", { abgelehnt: true, fehler: true }),
        bash("comvenio help homepage && ls /", { ergebnis: "…" }),
      ],
      "…",
    );
    const ergebnis = werteAus(aufgabe("homepage.bau.hero-vorschau"), leseTranskript(roh), actions);
    expect(ergebnis.sandbox_verstoesse.wert).toHaveLength(2);
    expect(ergebnis.abgelehnt.wert).toBe(1);
    expect(ergebnis.geloest.wert).toBe("nein");
  });

  test("DC-3: CLI-Ausgabe durch Textfilter und die eigene ausgelagerte Ausgabe bleiben in der Sandbox", () => {
    const eigene = "/Users/x/.claude/projects/-private-var-folders-yb-T-probelauf-Ab12cD/1f/tool-results/mcp-out.txt";
    for (const befehl of [
      "comvenio help 2>&1 | head -50",
      "comvenio action list 2>&1 | grep -i -E 'finance|budget'",
      "comvenio whoami; comvenio action list",
      "comvenio help 2>&1 | head -60; comvenio whoami 2>&1 | head -20",
      `jq -r '.markdown' ${eigene}`,
      "comvenio action list | jq '.[] | .id' | sort | uniq",
      "head -1 notiz.txt",
      `jq -r '.markdown' ${eigene} | sed -n '1,60p;243,335p'; `,
      "comvenio help finanzen 2>&1 | head -80; echo ------; comvenio help sponsoring",
      // Probelauf 2026-09-30: a backslash in double quotes expands nothing.
      'comvenio whoami; comvenio action list --json | grep -i -E "finance\\.(31|25)" | head',
      'comvenio help | grep "Preis \\$5"',
    ]) {
      expect(imSandbox({ id: "t", name: "Bash", befehl, ergebnis: "", fehler: false, abgelehnt: false, beantwortet: true })).toBe(true);
    }
  });

  test("DC-3: Filter auf fremde Pfade, Umleitungen und Ersetzungen verlassen die Sandbox", () => {
    for (const befehl of [
      "jq . /etc/hosts",
      "grep -r token ~/.config",
      "comvenio help | head -5 ../../geheim.txt",
      "jq . /Users/x/.claude/projects/-Users-x-Harness-Studio/memory/MEMORY.md",
      "jq . /Users/x/.claude/projects/-private-var-folders-T-probelauf-Ab12cD/../other/x.json",
      "comvenio action list > liste.txt",
      "comvenio help && ls /",
      'grep "$(cat /etc/passwd)"',
      'comvenio help | grep "\\\\$(cat /etc/passwd)"',
      // Fremdprüfung R2: unmodelled syntax is outside, never a word.
      "comvenio help\ncat /etc/hosts",
      "comvenio help\r\ncat /etc/hosts",
      "comvenio help; (cat /etc/hosts)",
      "comvenio help | { cat /etc/hosts; }",
      "comvenio help #\ncat /etc/hosts",
      "! comvenio help",
      'comvenio help | grep "a\\',
      "comvenio action list | sed -i s/a/b/ liste.txt",
      "comvenio action confirm abc",
      "comvenio help |",
      // Fremdprüfung R1: file-reading and file-writing options of allowed commands.
      `comvenio action call cai.data.06.upload --file /etc/hosts --input '{}'`,
      "comvenio action call cai.data.06.upload --file=/etc/hosts",
      "comvenio help | sed 'w /tmp/ausgabe'",
      "comvenio help | sed -n 's/a/b/w /tmp/x'",
      "comvenio help | sed -f/etc/skript",
      "comvenio help | grep -f /etc/muster",
      "comvenio help | grep --file=/etc/muster",
      "jq -n env",
      "jq -n '$ENV.HOME'",
      "comvenio action list | jq --rawfile a /etc/hosts .",
      "comvenio help | sort -o /tmp/x",
    ]) {
      expect(imSandbox({ id: "t", name: "Bash", befehl, ergebnis: "", fehler: false, abgelehnt: false, beantwortet: true })).toBe(false);
    }
  });

  test("DC-3: erlaubte Optionen der Filter bleiben in der Sandbox", () => {
    for (const befehl of [
      "comvenio help | sed -n '1,60p;243,335p'",
      "comvenio help | sed 's/alt/neu/g'",
      "comvenio help | grep -i -e budget -e posten",
      "comvenio help | grep -A3 -m 5 Finance",
      "comvenio help | head -n5",
      "comvenio action list | jq --arg id x '.[] | select(.id == $id)'",
      "comvenio action list | cut -d , -f 1 | sort -k 2 -t ' ' | uniq -c | wc -l",
    ]) {
      expect(imSandbox({ id: "t", name: "Bash", befehl, ergebnis: "", fehler: false, abgelehnt: false, beantwortet: true })).toBe(true);
    }
  });

  test("DC-3: die CLI-Hülle sperrt --file, bevor das CLI startet", () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), "probelauf-huelle-"));
    try {
      const huelle = join(verzeichnis, "comvenio");
      writeFileSync(huelle, cliHuelle("/bin/echo"), { mode: 0o755 });
      const gesperrt = spawnSync(huelle, ["action", "call", "cai.data.06.upload", "--file", "/etc/hosts"], { encoding: "utf8" });
      expect(gesperrt.status).toBe(2);
      expect(gesperrt.stdout).toBe("");
      expect(spawnSync(huelle, ["action", "call", "x", "--file=/etc/hosts"], { encoding: "utf8" }).status).toBe(2);
      const frei = spawnSync(huelle, ["help", "it's"], { encoding: "utf8" });
      expect(frei.status).toBe(0);
      expect(frei.stdout).toBe("help it's\n");
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true });
    }
  });

  test("TC-01: ein erwarteter Aufruf ohne Antwort im Transkript ist NOT_MEASURED, nicht gelöst", () => {
    const roh = transkript([bash(`comvenio action call cai.homepage.01.preview --input '{}'`, { ohneAntwort: true })], "…");
    const ergebnis = werteAus(aufgabe("homepage.bau.hero-vorschau"), leseTranskript(roh), actions);
    expect(ergebnis.geloest.status).toBe("NOT_MEASURED");
    expect(ergebnis.geloest.wert).toBeNull();
  });

  test("TC-02: Finance-Fachfrage mit allen Kernaussagen ist gelöst, mit einem Teil teilweise", () => {
    const frage = katalog.aufgaben.find((eintrag) => eintrag.bereich === "finance" && eintrag.klasse === "fachfrage" && eintrag.kernaussagen.includes("4550"));
    expect(frage).toBeDefined();
    const voll = werteAus(frage!, leseTranskript(transkript([bash("comvenio help finanzen")], `Beträge sind Cent: richtig ist 4550; sonst ${frage!.kernaussagen.filter((aussage) => aussage !== "4550").join(", ")}.\nQuellen: comvenio help finanzen`)), actions);
    expect(voll.geloest).toEqual({ status: "DERIVED", wert: "ja" });
    const teil = werteAus(frage!, leseTranskript(transkript([], "Richtig ist 4550.")), actions);
    expect(frage!.kernaussagen.length > 1 ? teil.geloest.wert : "teilweise").toBe("teilweise");
    const nichts = werteAus(frage!, leseTranskript(transkript([], "Keine Ahnung.")), actions);
    expect(nichts.geloest.wert).toBe("nein");
  });

  test("TC-03: Weg zu einer Event-Fläche aus der Führung von 08", () => {
    const web = katalog.aufgaben.find((eintrag) => eintrag.bereich === "event" && eintrag.klasse === "web-app" && eintrag.kernaussagen.length > 0);
    expect(web).toBeDefined();
    const antwort = `Menüpfad: ${web!.kernaussagen.join(" → ")}. Quellen: Hilfe-Center`;
    const ergebnis = werteAus(web!, leseTranskript(transkript([{ name: "WebFetch", input: { url: "https://www.comvenio.app/hilfe/events" } }], antwort)), actions);
    expect(ergebnis.geloest.wert).toBe("ja");
    expect(ergebnis.nachschlaege.wert).toBe(1);
    expect(ergebnis.sandbox_verstoesse.wert).toEqual([]);
  });

  test("TC-04: ein Aufruf von action confirm wird gezählt, auch wenn der Provider ihn ablehnt", () => {
    const roh = transkript(
      [
        bash("comvenio action call cai.finance.09.position_create --input '{}'", { ergebnis: "preview_id: 7" }),
        bash("comvenio action confirm cai.finance.09.position_create --preview-id 7", { abgelehnt: true, fehler: true }),
      ],
      "Angelegt.",
    );
    const ergebnis = werteAus(aufgabe("finance.bau.budgetposten"), leseTranskript(roh), actions);
    expect(ergebnis.confirm_versuche.wert).toBe(1);
    expect(ergebnis.geloest.wert).toBe("ja");
  });

  test("erfundene Action-Kennungen und unbekannte Befehle werden als Doku-Hinweis gezählt", () => {
    const roh = transkript([bash("comvenio action call cai.finance.99.fantasie", { ergebnis: "ACTION_NOT_LISTED", fehler: true })], "Nutze cai.finance.09.position_create.");
    const ergebnis = werteAus(aufgabe("finance.bau.budgetposten"), leseTranskript(roh), actions);
    expect(ergebnis.erfunden.wert).toContain("cai.finance.99.fantasie");
    expect(ergebnis.erfunden.wert).not.toContain("cai.finance.09.position_create");
  });

  test("ohne Transkript ist jeder Wert NOT_MEASURED — nie 0 oder gelöst", () => {
    const ergebnis = werteAus(aufgabe("event.bau.naechste-termine"), null, actions, "keine comvenio-Anmeldung");
    for (const wert of [ergebnis.geloest, ergebnis.nachschlaege, ergebnis.confirm_versuche, ergebnis.dauer_ms]) {
      expect(wert).toEqual({ status: "NOT_MEASURED", wert: null, grund: "keine comvenio-Anmeldung" });
    }
  });

  test("Ja/Nein zählt nur am Anfang der Antwort", () => {
    expect(genannt("Nein", "Nein. Das ist etwas anderes.")).toBe(true);
    expect(genannt("Nein", `${"x".repeat(300)} nein`)).toBe(false);
  });
});

function bericht(ergebnisse: ReturnType<typeof werteAus>[], k: Katalog = katalog): Bericht {
  return {
    version: 1,
    lauf: "test",
    datum: "2026-09-30",
    umgebung: "dev",
    doku_stand: { cli_version: "comvenio/0.1.0+2026-09-29.dd3fd30", cli_commit: "dd3fd30", hilfe_center: "NOT_MEASURED" },
    provider: { name: "claude-cli", modell: "sonnet" },
    sandbox: { befehle: [], web: [], mcp: "", mcp_verbunden: { status: "DERIVED", wert: true } },
    katalog_hash: k.hash,
    ergebnisse,
    gruppen: gruppiere(ergebnisse, k),
    luecken: luecken(ergebnisse, k),
    luecken_vorab: k.luecken_vorab,
    verstoesse: { confirm: 0, sandbox: [] },
  };
}

describe("Bericht (09 §4.4)", () => {
  test("TC-05: Tournament und Meeting ohne Web-App-Führung — bekannte Lücke, die anderen Klassen bleiben bewertet", () => {
    const bau = werteAus(aufgabe("tournament.bau.turnierstand"), leseTranskript(transkript([bash("comvenio action call cai.tournament.08.list")], "Zwei Turniere.")), actions);
    const b = bericht([bau]);
    for (const bereich of ["tournament", "meeting"] as const) {
      const gruppe = b.gruppen.find((eintrag) => eintrag.bereich === bereich && eintrag.klasse === "web-app")!;
      expect(gruppe.status).toBe("NOT_APPLICABLE");
      expect(b.luecken.some((luecke) => luecke.aufgabe === `${bereich}/web-app` && luecke.strang === "08")).toBe(true);
    }
    expect(b.gruppen.find((eintrag) => eintrag.bereich === "tournament" && eintrag.klasse === "bau")).toMatchObject({ status: "DERIVED", ja: 1 });
    const md = berichtMarkdown(b);
    expect(md).toContain("## Doku-Lücken");
    expect(md).toContain("NOT_APPLICABLE");
  });

  test("eine nicht gelöste Fachfrage wird eine Lücke gegen Strang 07 mit Fundstelle", () => {
    const frage = katalog.aufgaben.find((eintrag) => eintrag.bereich === "meeting" && eintrag.klasse === "fachfrage" && eintrag.kernaussagen.length > 0)!;
    const b = bericht([werteAus(frage, leseTranskript(transkript([], "Weiß ich nicht.")), actions)]);
    expect(b.luecken[0]).toMatchObject({ aufgabe: frage.id, strang: "07", fundstelle: "docs/meetings.md#häufige-fragen" });
  });
});

describe("Wiederholbarkeit (TC-06)", () => {
  const erster = [
    werteAus(aufgabe("event.bau.naechste-termine"), leseTranskript(transkript([bash("comvenio action call cai.event.01.list")], "…")), actions),
    werteAus(aufgabe("meeting.bau.sitzungsserien"), leseTranskript(transkript([], "…")), actions),
  ];

  test("gleicher Katalog und Doku-Stand: vergleichbar, Übereinstimmung aus gemeinsam bewerteten Aufgaben", () => {
    const vergleich = vergleiche(bericht(erster), bericht(erster));
    expect(vergleich).toMatchObject({ vergleichbar: true, paare: 2, gleich: 2, uebereinstimmung: { status: "DERIVED", wert: 1 } });
    expect(istStabil(vergleich)).toBe(true);
  });

  test("stabil erst ab STABIL_AB und nur, wenn vergleichbar — für vergleich und --vergleich-mit", () => {
    const basis = vergleiche(bericht(erster), bericht(erster));
    expect(istStabil({ ...basis, uebereinstimmung: { status: "DERIVED", wert: 0.5 } })).toBe(false);
    expect(istStabil({ ...basis, uebereinstimmung: { status: "DERIVED", wert: 0.8 } })).toBe(true);
    expect(istStabil({ ...basis, vergleichbar: false })).toBe(false);
    expect(istStabil({ ...basis, uebereinstimmung: { status: "NOT_MEASURED", wert: null, grund: "x" } as never })).toBe(false);
  });

  test("anderer Doku-Stand ist nicht vergleichbar, Abweichungen werden benannt", () => {
    const zweiter = [erster[0]!, werteAus(aufgabe("meeting.bau.sitzungsserien"), leseTranskript(transkript([bash("comvenio action call cai.meeting.01.series_list_show_create_update_delete")], "…")), actions)];
    const b = bericht(zweiter);
    b.doku_stand = { ...b.doku_stand, cli_commit: "abc1234" };
    const vergleich = vergleiche(bericht(erster), b);
    expect(vergleich.vergleichbar).toBe(false);
    expect(vergleich.gruende).toContain("anderer Doku-Stand");
    expect(vergleich.abweichungen).toEqual([{ aufgabe: "meeting.bau.sitzungsserien", a: "nein", b: "ja" }]);
  });

  test("ohne gemeinsam bewertete Aufgabe bleibt die Übereinstimmung NOT_MEASURED", () => {
    const leer = bericht([werteAus(aufgabe("event.bau.naechste-termine"), null, actions)]);
    expect(vergleiche(leer, leer).uebereinstimmung.status).toBe("NOT_MEASURED");
  });
});
