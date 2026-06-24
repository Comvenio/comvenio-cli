// Resolve the active club_id from the state file (or an explicit --club flag).
// Every domain command needs this — club isolation runs over the state file +
// server-side RBAC (Sub-File 04 Anti-Pattern: never guess club_id).
import { AuthError, type ComvenioCliState } from "../auth.ts";

/**
 * Return the club_id to operate on: explicit --club override wins, else the
 * state-file clubId. Throws AuthError (exit code 2) when neither is present.
 */
export function requireClubId(state: ComvenioCliState, override?: string): string {
  const clubId = override ?? state.clubId;
  if (!clubId) {
    throw new AuthError(
      'Keine Club-ID im State. Gib "--club <id>" an oder logge dich erneut mit "--club <id>" ein.',
    );
  }
  return clubId;
}
