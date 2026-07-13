// K18 (tournament-hub 14/16): parse tennis set notation into the canonical
// backend contract score.sets (see tournament-service MatchResultSubmit).
//
//   "6:2,7:6(9:7)"          -> two sets, second with tiebreak points 9:7
//   "7:6(7:4),1:6,MTB2:10"  -> deciding match tiebreak 2:10 as third entry
//
// Errors are thrown BEFORE any HTTP request (AK-18-01).

export type SetEntry = {
  home: number;
  away: number;
  type?: "set" | "match_tiebreak";
  tiebreak?: { home: number; away: number };
};

const SET_RE = /^(MTB)?(\d+):(\d+)(?:\((\d+):(\d+)\))?$/i;

export function parseSetsNotation(notation: string): SetEntry[] {
  const parts = notation
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(
      'Leere --sets Angabe. Beispiel: --sets "6:2,7:6(9:7)" oder "7:6(7:4),1:6,MTB10:7"',
    );
  }
  return parts.map((part) => {
    const match = SET_RE.exec(part);
    if (!match) {
      throw new Error(
        `Ungueltiger Satz "${part}". Format: H:A, optional (x:y) fuer Tiebreak-Punkte, ` +
          'Prefix MTB fuer Match-Tiebreak. Beispiel: --sets "6:2,7:6(9:7)" oder "7:6(7:4),1:6,MTB10:7"',
      );
    }
    const [, mtb, home, away, tbHome, tbAway] = match;
    const entry: SetEntry = { home: Number(home), away: Number(away) };
    if (mtb) entry.type = "match_tiebreak";
    if (tbHome != null && tbAway != null) {
      if (mtb) {
        throw new Error(
          `Match-Tiebreak "${part}" darf keine zusaetzlichen Tiebreak-Punkte tragen — der Eintrag IST der Tiebreak.`,
        );
      }
      entry.tiebreak = { home: Number(tbHome), away: Number(tbAway) };
    }
    return entry;
  });
}
