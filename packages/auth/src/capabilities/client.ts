import { assertCapability } from "./errors.ts";
import { validateCapabilityUuid } from "./validation.ts";

export function buildEffectivePermissionSelfPath(input: {
  club_id: string;
  department_id?: string | null;
}): string {
  const clubId = validateCapabilityUuid(input.club_id, "Die Vereins-ID");
  const parameters = new URLSearchParams({ club_id: clubId });
  if (input.department_id !== undefined && input.department_id !== null) {
    parameters.set("department_id", validateCapabilityUuid(input.department_id, "Die Abteilungs-ID"));
  }
  const path = `/permissions/effective/self?${parameters.toString()}`;
  assertCapability(!path.includes("member_id"), "CAPABILITY_INVALID",
    "Der Self-Endpunkt darf keine Mitglieds-ID annehmen.");
  return path;
}
