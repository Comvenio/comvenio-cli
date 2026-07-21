import {
  createConnectorError,
  type UUID,
} from "@comvenio/connector-contracts";

import type { ClubSelectionContext } from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createClubSelectionContext(input: {
  eligible_club_ids: readonly UUID[];
  selected_club_id?: UUID | null;
  request_id: UUID;
}): ClubSelectionContext {
  const eligible = [...new Set(input.eligible_club_ids)].sort();
  if (eligible.length === 0 || !eligible.every((clubId) => UUID_PATTERN.test(clubId))) {
    throw createConnectorError({
      code: "PERMISSION_DENIED",
      message: "Für die Verbindung ist kein berechtigter Verein verfügbar.",
      request_id: input.request_id,
      retryable: false,
    });
  }
  if (eligible.length === 1) {
    const onlyClub = eligible[0] as UUID;
    if (input.selected_club_id && input.selected_club_id !== onlyClub) {
      throw createConnectorError({
        code: "TENANT_MISMATCH",
        message: "Der gewählte Verein ist für diese Verbindung nicht verfügbar.",
        request_id: input.request_id,
        retryable: false,
      });
    }
    return {
      eligible_club_ids: eligible,
      selected_club_id: onlyClub,
      selection_mode: "automatic_single_club",
    };
  }
  if (!input.selected_club_id) {
    throw createConnectorError({
      code: "CLUB_SELECTION_REQUIRED",
      message: "Bitte wähle den Verein für diese Verbindung aus.",
      request_id: input.request_id,
      retryable: false,
    });
  }
  if (!eligible.includes(input.selected_club_id)) {
    throw createConnectorError({
      code: "TENANT_MISMATCH",
      message: "Der gewählte Verein ist für diese Verbindung nicht verfügbar.",
      request_id: input.request_id,
      retryable: false,
    });
  }
  return {
    eligible_club_ids: eligible,
    selected_club_id: input.selected_club_id,
    selection_mode: "explicit_multi_club",
  };
}
