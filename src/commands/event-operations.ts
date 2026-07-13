import { basename } from "node:path";
import { readFileSync } from "node:fs";

import type { ComvenioClient } from "../http.ts";
import { output } from "../format.ts";
import { readJsonFile } from "../util/file.ts";
import { prune } from "../util/body.ts";

export type EventOperationOpts = {
  json?: boolean;
  file?: string;
  title?: string;
  description?: string;
  name?: string;
  notes?: string;
  status?: string;
  start?: string;
  end?: string;
  startTime?: string;
  area?: string;
  sortOrder?: string;
  memberId?: string;
  userId?: string;
  categoryId?: string;
  tagId?: string;
  targetType?: string;
  targetId?: string;
  attachmentType?: string;
  attachmentId?: string;
  assetId?: string;
  advertiserId?: string;
  programItemId?: string;
  tier?: string;
  label?: string;
  assetType?: string;
  provider?: string;
  limit?: string;
  offset?: string;
  key?: string;
};

type HandlerArgs = {
  action: string;
  sub: string | undefined;
  id: string | undefined;
  opts: EventOperationOpts;
  client: ComvenioClient;
  clubId: string;
};

function requireId(id: string | undefined, command: string, label: string): string {
  if (!id) throw new Error(`${command} benötigt <${label}>.`);
  return id;
}

function bodyFile(opts: EventOperationOpts, command: string): Record<string, unknown> {
  if (!opts.file) throw new Error(`${command} benötigt --file <payload.json>.`);
  const body = readJsonFile<unknown>(opts.file);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${command}: --file muss ein JSON-Objekt enthalten.`);
  }
  return body as Record<string, unknown>;
}

function withClub(body: Record<string, unknown>, clubId: string): Record<string, unknown> {
  return { ...body, club_id: clubId };
}

function withTargetClubs(body: Record<string, unknown>, clubId: string): Record<string, unknown> {
  const targets = Array.isArray(body.targets)
    ? body.targets.map((target) => {
        if (!target || typeof target !== "object" || Array.isArray(target)) return target;
        return { ...(target as Record<string, unknown>), club_id: clubId };
      })
    : body.targets;
  return { ...body, ...(targets ? { targets } : {}) };
}

function params(values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null && value !== "") query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function emit(data: unknown, json: boolean | undefined, message: string): void {
  output(data, json, () => {
    if (Array.isArray(data)) return `${message}: ${data.length} Eintrag/Einträge.`;
    if (data && typeof data === "object" && "id" in data) {
      return `${message}: ${(data as { id?: unknown }).id ?? "OK"}`;
    }
    return message;
  });
}

async function removed(client: ComvenioClient, path: string, id: string, opts: EventOperationOpts, label: string): Promise<void> {
  await client.del("event", path);
  emit({ deleted: id }, opts.json, `${label} entfernt`);
}

async function handleArea({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  if (!new Set(["show", "update", "delete", "bulk", "copy"]).has(sub ?? "")) return false;
  if (sub === "show") {
    const areaId = requireId(id, "event area show", "area-id");
    emit(await client.get("event", `/events/areas/${areaId}`), opts.json, "Bereich geladen");
  } else if (sub === "update") {
    const areaId = requireId(id, "event area update", "area-id");
    const current = await client.get<Record<string, unknown>>("event", `/events/areas/${areaId}`);
    const patch = bodyFile(opts, "event area update");
    const body = {
      name: current.name,
      description: current.description,
      color: current.color,
      is_public: current.is_public,
      public_description: current.public_description,
      area_category: current.area_category,
      ...patch,
      event_id: current.event_id,
      club_id: clubId,
    };
    emit(await client.patch("event", `/events/areas/${areaId}`, body), opts.json, "Bereich aktualisiert");
  } else if (sub === "delete") {
    const areaId = requireId(id, "event area delete", "area-id");
    await removed(client, `/events/areas/${areaId}`, areaId, opts, "Bereich");
  } else if (sub === "bulk") {
    emit(await client.post("event", "/events/areas/bulk", withClub(bodyFile(opts, "event area bulk"), clubId)), opts.json, "Bereiche angelegt");
  } else if (sub === "copy") {
    emit(await client.post("event", "/events/areas/copy-to-events", bodyFile(opts, "event area copy")), opts.json, "Bereiche kopiert");
  }
  return true;
}

async function handleAssignment({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const areaId = requireId(id, `event assignment ${sub ?? ""}`, "area-id");
  if (sub === "list") {
    emit(await client.get("event", `/events/areas/${areaId}/assignments`), opts.json, "Bereichszuweisungen");
  } else if (sub === "add") {
    if (!opts.memberId) throw new Error("event assignment add benötigt --member-id <id>.");
    const area = await client.get<Record<string, unknown>>("event", `/events/areas/${areaId}`);
    const body = {
      club_id: clubId,
      event_id: area.event_id,
      event_area_id: areaId,
      member_id: opts.memberId,
    };
    emit(await client.post("event", `/events/areas/${areaId}/assign-member`, body), opts.json, "Mitglied zugewiesen");
  } else if (sub === "remove") {
    if (!opts.memberId) throw new Error("event assignment remove benötigt --member-id <id>.");
    await removed(client, `/events/areas/${areaId}/assign-member/${opts.memberId}`, opts.memberId, opts, "Bereichszuweisung");
  } else if (sub === "clear") {
    await removed(client, `/events/areas/${areaId}/assignments`, areaId, opts, "Bereichszuweisungen");
  } else {
    throw new Error(`Unbekannte event-assignment-Aktion "${sub}". Verfügbar: list, add, remove, clear`);
  }
  return true;
}

async function handleLead({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event lead ${sub ?? ""}`, sub === "list" || sub === "add" ? "area-id" : "lead-id");
  if (sub === "list") {
    emit(await client.get("event", `/events/areas/${primaryId}/leads`), opts.json, "Bereichsleitungen");
  } else if (sub === "add") {
    emit(await client.post("event", `/events/areas/${primaryId}/leads`, withClub({ ...bodyFile(opts, "event lead add"), event_area_id: primaryId }, clubId)), opts.json, "Bereichsleitung angelegt");
  } else if (sub === "update") {
    emit(await client.patch("event", `/events/areas/leads/${primaryId}`, bodyFile(opts, "event lead update")), opts.json, "Bereichsleitung aktualisiert");
  } else if (sub === "delete") {
    await removed(client, `/events/areas/leads/${primaryId}`, primaryId, opts, "Bereichsleitung");
  } else {
    throw new Error(`Unbekannte event-lead-Aktion "${sub}". Verfügbar: list, add, update, delete`);
  }
  return true;
}

async function handleAreaNote({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event area-note ${sub ?? ""}`, sub === "list" || sub === "add" ? "area-id" : "note-id");
  const noteBody = () => opts.file ? bodyFile(opts, `event area-note ${sub}`) : prune({ content: opts.notes });
  if (sub === "list") {
    emit(await client.get("event", `/events/areas/${primaryId}/notes${params({ limit: opts.limit, offset: opts.offset })}`), opts.json, "Bereichsnotizen");
  } else if (sub === "add") {
    const body = noteBody();
    if (!body.content) throw new Error("event area-note add benötigt --notes <text> oder --file.");
    emit(await client.post("event", `/events/areas/${primaryId}/notes`, body), opts.json, "Notiz angelegt");
  } else if (sub === "update") {
    const body = noteBody();
    if (!body.content) throw new Error("event area-note update benötigt --notes <text> oder --file.");
    emit(await client.put("event", `/events/areas/notes/${primaryId}`, body), opts.json, "Notiz aktualisiert");
  } else if (sub === "delete") {
    await removed(client, `/events/areas/notes/${primaryId}`, primaryId, opts, "Notiz");
  } else {
    throw new Error(`Unbekannte event-area-note-Aktion "${sub}". Verfügbar: list, add, update, delete`);
  }
  return true;
}

async function handleProgram({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  if (!new Set(["update", "delete", "reorder"]).has(sub ?? "")) return false;
  const primaryId = requireId(id, `event program ${sub}`, sub === "reorder" ? "event-id" : "program-item-id");
  if (sub === "update") emit(await client.patch("event", `/events/program-items/${primaryId}`, bodyFile(opts, "event program update")), opts.json, "Programmpunkt aktualisiert");
  if (sub === "delete") await removed(client, `/events/program-items/${primaryId}`, primaryId, opts, "Programmpunkt");
  if (sub === "reorder") emit(await client.put("event", `/events/${primaryId}/program-items/reorder`, bodyFile(opts, "event program reorder")), opts.json, "Programm sortiert");
  return true;
}

async function handleContact({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event contact ${sub ?? ""}`, sub === "list" || sub === "add" ? "event-id" : "contact-id");
  if (sub === "list") emit(await client.get("event", `/events/${primaryId}/contacts`), opts.json, "Kontakte");
  else if (sub === "add") emit(await client.post("event", `/events/${primaryId}/contacts`, withClub(bodyFile(opts, "event contact add"), clubId)), opts.json, "Kontakt angelegt");
  else if (sub === "update") emit(await client.patch("event", `/events/contacts/${primaryId}`, bodyFile(opts, "event contact update")), opts.json, "Kontakt aktualisiert");
  else if (sub === "delete") await removed(client, `/events/contacts/${primaryId}`, primaryId, opts, "Kontakt");
  else throw new Error(`Unbekannte event-contact-Aktion "${sub}". Verfügbar: list, add, update, delete`);
  return true;
}

async function handleResource({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  if (sub === "usage") {
    if (!opts.targetType || !opts.targetId) throw new Error("event resource usage benötigt --target-type und --target-id.");
    const query = params({ target_type: opts.targetType, target_id: opts.targetId, start: opts.start, end: opts.end, statuses: opts.status });
    emit(await client.get("event", `/events/resource-usage/${query}`), opts.json, "Ressourcenauslastung");
    return true;
  }
  if (sub === "usage-batch") {
    emit(await client.post("event", "/events/resource-usage/batch", withTargetClubs(bodyFile(opts, "event resource usage-batch"), clubId)), opts.json, "Ressourcenauslastung");
    return true;
  }
  const primaryId = requireId(id, `event resource ${sub ?? ""}`, ["link-show", "link-update", "link-delete"].includes(sub ?? "") ? "resource-link-id" : "event-id");
  if (sub === "list") emit(await client.get("event", `/events/${primaryId}/resources`), opts.json, "Event-Ressourcen");
  else if (sub === "add") emit(await client.post("event", `/events/${primaryId}/resources`, withTargetClubs(bodyFile(opts, "event resource add"), clubId)), opts.json, "Ressourcen verknüpft");
  else if (sub === "set") emit(await client.put("event", `/events/${primaryId}/resources`, withTargetClubs(bodyFile(opts, "event resource set"), clubId)), opts.json, "Ressourcen gesetzt");
  else if (sub === "remove") emit(await client.del("event", `/events/${primaryId}/resources${params({ target_type: opts.targetType, target_id: opts.targetId })}`), opts.json, "Ressourcen entfernt");
  else if (sub === "link-show") emit(await client.get("event", `/event-resource-links/${primaryId}`), opts.json, "Ressourcen-Link");
  else if (sub === "link-update") emit(await client.patch("event", `/event-resource-links/${primaryId}`, bodyFile(opts, "event resource link-update")), opts.json, "Ressourcen-Link aktualisiert");
  else if (sub === "link-delete") await removed(client, `/event-resource-links/${primaryId}`, primaryId, opts, "Ressourcen-Link");
  else throw new Error(`Unbekannte event-resource-Aktion "${sub}". Verfügbar: list, add, set, remove, link-show, link-update, link-delete, usage, usage-batch`);
  return true;
}

async function handleAttachment({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event attachment ${sub ?? ""}`, sub === "list" || sub === "add" ? "event-id" : "attachment-link-id");
  if (sub === "list") {
    emit(await client.get("event", `/events/${primaryId}/attachments${params({ attachment_type: opts.attachmentType })}`), opts.json, "Anhänge");
  } else if (sub === "show") {
    emit(await client.get("event", `/events/attachments/${primaryId}`), opts.json, "Anhang");
  } else if (sub === "add") {
    const body = opts.file
      ? bodyFile(opts, "event attachment add")
      : prune({ attachment_type: opts.attachmentType, attachment_id: opts.attachmentId, title: opts.title, note: opts.notes, event_area_id: opts.area });
    if (!body.attachment_type || !body.attachment_id) throw new Error("event attachment add benötigt --attachment-type und --attachment-id oder --file.");
    emit(await client.post("event", `/events/${primaryId}/attachments`, { ...body, event_id: primaryId, club_id: clubId }), opts.json, "Anhang verknüpft");
  } else if (sub === "update") {
    const body = opts.file ? bodyFile(opts, "event attachment update") : prune({ title: opts.title, note: opts.notes, event_area_id: opts.area });
    emit(await client.patch("event", `/events/attachments/${primaryId}`, body), opts.json, "Anhang aktualisiert");
  } else if (sub === "delete") {
    await removed(client, `/events/attachments/${primaryId}`, primaryId, opts, "Anhang");
  } else {
    throw new Error(`Unbekannte event-attachment-Aktion "${sub}". Verfügbar: list, show, add, update, delete`);
  }
  return true;
}

async function handleTag({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const nameBody = () => opts.file ? bodyFile(opts, `event tag ${sub}`) : prune({ name: opts.name, description: opts.description });
  if (sub === "category-list") emit(await client.get("event", `/events/tags/category/by-club/${clubId}`), opts.json, "Tag-Kategorien");
  else if (sub === "category-show") emit(await client.get("event", `/events/tags/category/${requireId(id, "event tag category-show", "category-id")}`), opts.json, "Tag-Kategorie");
  else if (sub === "category-add") emit(await client.post("event", "/events/tags/category", withClub(nameBody(), clubId)), opts.json, "Tag-Kategorie angelegt");
  else if (sub === "category-update") emit(await client.patch("event", `/events/tags/category/${requireId(id, "event tag category-update", "category-id")}`, nameBody()), opts.json, "Tag-Kategorie aktualisiert");
  else if (sub === "category-delete") {
    const categoryId = requireId(id, "event tag category-delete", "category-id");
    await removed(client, `/events/tags/category/${categoryId}`, categoryId, opts, "Tag-Kategorie");
  } else if (sub === "list") emit(await client.get("event", opts.categoryId ? `/events/tags/by-club/${clubId}/by-category/${opts.categoryId}` : `/events/tags/by-club/${clubId}`), opts.json, "Tags");
  else if (sub === "show") emit(await client.get("event", `/events/tags/${requireId(id, "event tag show", "tag-id")}`), opts.json, "Tag");
  else if (sub === "add") emit(await client.post("event", "/events/tags/", withClub({ ...nameBody(), category_id: opts.categoryId }, clubId)), opts.json, "Tag angelegt");
  else if (sub === "update") emit(await client.patch("event", `/events/tags/${requireId(id, "event tag update", "tag-id")}`, { ...nameBody(), ...(opts.categoryId ? { category_id: opts.categoryId } : {}) }), opts.json, "Tag aktualisiert");
  else if (sub === "delete") {
    const tagId = requireId(id, "event tag delete", "tag-id");
    await removed(client, `/events/tags/${tagId}`, tagId, opts, "Tag");
  } else if (sub === "assigned") {
    const eventId = requireId(id, "event tag assigned", "event-id");
    emit(await client.get("event", `/events/tags/assigned-tags/by-event/${eventId}/by-club/${clubId}`), opts.json, "Zugewiesene Tags");
  } else if (sub === "assignment-list") {
    const eventId = requireId(id, "event tag assignment-list", "event-id");
    emit(await client.get("event", `/events/tags/assign/by-event/${eventId}`), opts.json, "Tag-Zuweisungen");
  } else if (sub === "assign") {
    const eventId = requireId(id, "event tag assign", "event-id");
    if (!opts.tagId) throw new Error("event tag assign benötigt --tag-id <id>.");
    emit(await client.post("event", "/events/tags/assign", { club_id: clubId, event_id: eventId, tag_id: opts.tagId }), opts.json, "Tag zugewiesen");
  } else if (sub === "unassign") {
    const assignmentId = requireId(id, "event tag unassign", "assignment-id");
    await removed(client, `/events/tags/assign/${assignmentId}`, assignmentId, opts, "Tag-Zuweisung");
  } else if (sub === "clear") {
    const eventId = requireId(id, "event tag clear", "event-id");
    await removed(client, `/events/tags/assign/by-event/${eventId}`, eventId, opts, "Tag-Zuweisungen");
  } else throw new Error(`Unbekannte event-tag-Aktion "${sub}". Siehe docs/veranstaltungen.md.`);
  return true;
}

async function handleSponsor({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event sponsor ${sub ?? ""}`, sub === "list" || sub === "add" || sub === "tier-list" || sub === "tier-add" || sub === "tier-sync" ? "event-id" : "link-id");
  if (sub === "list") emit(await client.get("event", `/events/${primaryId}/sponsor-links`), opts.json, "Event-Sponsoren");
  else if (sub === "add") {
    const body = opts.file ? bodyFile(opts, "event sponsor add") : prune({ advertiser_id: opts.advertiserId, area_id: opts.area, tier: opts.tier, sort_order: opts.sortOrder == null ? undefined : Number(opts.sortOrder) });
    if (!body.advertiser_id) throw new Error("event sponsor add benötigt --advertiser-id <id> oder --file.");
    emit(await client.post("event", `/events/${primaryId}/sponsor-links`, withClub(body, clubId)), opts.json, "Sponsor verknüpft");
  } else if (sub === "delete") await removed(client, `/events/sponsor-links/${primaryId}`, primaryId, opts, "Sponsor-Link");
  else if (sub === "tier-list") emit(await client.get("event", `/events/${primaryId}/sponsor-tier-mappings`), opts.json, "Sponsor-Tier-Mappings");
  else if (sub === "tier-add") emit(await client.post("event", `/events/${primaryId}/sponsor-tier-mappings`, bodyFile(opts, "event sponsor tier-add")), opts.json, "Sponsor-Tier-Mapping angelegt");
  else if (sub === "tier-update") emit(await client.patch("event", `/events/sponsor-tier-mappings/${primaryId}`, bodyFile(opts, "event sponsor tier-update")), opts.json, "Sponsor-Tier-Mapping aktualisiert");
  else if (sub === "tier-delete") await removed(client, `/events/sponsor-tier-mappings/${primaryId}`, primaryId, opts, "Sponsor-Tier-Mapping");
  else if (sub === "tier-sync") emit(await client.post("event", `/events/${primaryId}/sponsor-tier-mappings/sync`), opts.json, "Sponsor-Tiers synchronisiert");
  else throw new Error(`Unbekannte event-sponsor-Aktion "${sub}". Verfügbar: list, add, delete, tier-list, tier-add, tier-update, tier-delete, tier-sync`);
  return true;
}

async function handleSponsorProgram({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event sponsor-program ${sub ?? ""}`, sub === "by-program" ? "program-item-id" : sub === "delete" ? "link-id" : "sponsor-link-id");
  if (sub === "list") emit(await client.get("event", `/events/sponsor-links/${primaryId}/program-items`), opts.json, "Sponsor-Programm-Verknüpfungen");
  else if (sub === "by-program") emit(await client.get("event", `/events/program-items/${primaryId}/sponsor-links`), opts.json, "Programm-Sponsoren");
  else if (sub === "add") {
    const body = opts.file ? bodyFile(opts, "event sponsor-program add") : prune({ program_item_id: opts.programItemId, label: opts.label });
    if (!body.program_item_id) throw new Error("event sponsor-program add benötigt --program-item-id <id> oder --file.");
    emit(await client.post("event", `/events/sponsor-links/${primaryId}/program-items`, body), opts.json, "Sponsor mit Programmpunkt verknüpft");
  } else if (sub === "delete") await removed(client, `/events/sponsor-link-program-items/${primaryId}`, primaryId, opts, "Sponsor-Programm-Verknüpfung");
  else throw new Error(`Unbekannte event-sponsor-program-Aktion "${sub}". Verfügbar: list, by-program, add, delete`);
  return true;
}

async function handleInvitation({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  if (sub === "mine") {
    const path = opts.status
      ? `/events/invitations/my-invitations/status/${encodeURIComponent(opts.status)}`
      : "/events/invitations/my-invitations";
    emit(await client.get("event", path), opts.json, "Eigene Einladungen");
  }
  else if (sub === "list") {
    const eventId = requireId(id, "event invitation list", "event-id");
    const path = opts.status ? `/events/invitations/by-event/${eventId}/status/${opts.status}` : `/events/invitations/by-event/${eventId}`;
    emit(await client.get("event", path), opts.json, "Mitglieder-Einladungen");
  } else if (sub === "show") emit(await client.get("event", `/events/invitations/${requireId(id, "event invitation show", "invitation-id")}`), opts.json, "Einladung");
  else if (sub === "add") {
    const eventId = requireId(id, "event invitation add", "event-id");
    const body = opts.file ? bodyFile(opts, "event invitation add") : prune({ user_id: opts.userId, status: opts.status });
    if (!body.user_id) throw new Error("event invitation add benötigt --user-id <id> oder --file.");
    emit(await client.post("event", "/events/invitations/", { ...body, event_id: eventId, club_id: clubId }), opts.json, "Einladung angelegt");
  } else if (["groups", "departments", "org-groups"].includes(sub ?? "")) {
    const suffix = sub === "groups" ? "by-groups" : sub === "departments" ? "by-departments" : "by-org-groups";
    emit(await client.post("event", `/events/invitations/${suffix}`, withClub(bodyFile(opts, `event invitation ${sub}`), clubId)), opts.json, "Einladungen angelegt");
  } else if (sub === "update") emit(await client.patch("event", `/events/invitations/${requireId(id, "event invitation update", "invitation-id")}`, bodyFile(opts, "event invitation update")), opts.json, "Einladung aktualisiert");
  else if (sub === "status") {
    const invitationId = requireId(id, "event invitation status", "invitation-id");
    if (!opts.status && !opts.file) throw new Error("event invitation status benötigt --status <wert> oder --file.");
    emit(await client.patch("event", `/events/invitations/status/${invitationId}`, opts.file ? bodyFile(opts, "event invitation status") : { status: opts.status }), opts.json, "Einladungsstatus aktualisiert");
  } else if (sub === "delete") {
    const invitationId = requireId(id, "event invitation delete", "invitation-id");
    await removed(client, `/events/invitations/${invitationId}`, invitationId, opts, "Einladung");
  } else if (sub === "notified") {
    const eventId = requireId(id, "event invitation notified", "event-id");
    emit(await client.get("event", `/events/invitations/by-event/${eventId}/notified`), opts.json, "Benachrichtigte User");
  } else throw new Error(`Unbekannte event-invitation-Aktion "${sub}". Siehe docs/veranstaltungen.md.`);
  return true;
}

async function handleClubInvitation({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  if (sub === "list" || sub === "attending") {
    const eventId = requireId(id, `event club-invitation ${sub}`, "event-id");
    emit(await client.get("event", `/events/club-invitations/by-event/${eventId}${sub === "attending" ? "/attending" : ""}`), opts.json, "Club-Einladungen");
  } else if (sub === "incoming" || sub === "accepted") {
    emit(await client.get("event", `/events/club-invitations/by-invited-club/${id ?? clubId}${sub === "accepted" ? "/accepted" : ""}`), opts.json, "Eingehende Club-Einladungen");
  } else if (sub === "show") emit(await client.get("event", `/events/club-invitations/${requireId(id, "event club-invitation show", "invitation-id")}`), opts.json, "Club-Einladung");
  else if (sub === "add") emit(await client.post("event", "/events/club-invitations/", withClub(bodyFile(opts, "event club-invitation add"), clubId)), opts.json, "Club eingeladen");
  else if (sub === "external") emit(await client.post("event", "/club-event-invitations/external", bodyFile(opts, "event club-invitation external")), opts.json, "Externer Club eingeladen");
  else if (sub === "self-join") emit(await client.post("event", "/events/club-invitations/self-join", { event_id: requireId(id, "event club-invitation self-join", "event-id"), club_id: clubId }), opts.json, "Club beigetreten");
  else if (sub === "update") emit(await client.patch("event", `/events/club-invitations/${requireId(id, "event club-invitation update", "invitation-id")}`, bodyFile(opts, "event club-invitation update")), opts.json, "Club-Einladung aktualisiert");
  else if (sub === "respond") emit(await client.patch("event", `/events/club-invitations/${requireId(id, "event club-invitation respond", "invitation-id")}/respond`, bodyFile(opts, "event club-invitation respond")), opts.json, "Club-Einladung beantwortet");
  else if (sub === "delete") {
    const invitationId = requireId(id, "event club-invitation delete", "invitation-id");
    await removed(client, `/events/club-invitations/${invitationId}`, invitationId, opts, "Club-Einladung");
  } else throw new Error(`Unbekannte event-club-invitation-Aktion "${sub}". Siehe docs/veranstaltungen.md.`);
  return true;
}

async function handleRegistration({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event registration ${sub ?? ""}`, ["list", "add", "stats"].includes(sub ?? "") ? "event-id" : sub === "aggregate" ? "club-invitation-id" : "registration-id");
  if (sub === "list") emit(await client.get("event", `/events/${primaryId}/attendee-registrations`), opts.json, "Anmeldungen");
  else if (sub === "add") emit(await client.post("event", `/events/${primaryId}/attendee-registrations`, bodyFile(opts, "event registration add")), opts.json, "Anmeldung angelegt");
  else if (sub === "stats") emit(await client.get("event", `/events/${primaryId}/attendee-stats`), opts.json, "Teilnehmerstatistik");
  else if (sub === "show") emit(await client.get("event", `/event-attendee-registrations/${primaryId}`), opts.json, "Anmeldung");
  else if (sub === "update") emit(await client.patch("event", `/event-attendee-registrations/${primaryId}`, bodyFile(opts, "event registration update")), opts.json, "Anmeldung aktualisiert");
  else if (sub === "adjust") emit(await client.patch("event", `/event-attendee-registrations/${primaryId}/admin-adjust`, bodyFile(opts, "event registration adjust")), opts.json, "Teilnehmerzahl korrigiert");
  else if (sub === "delete") await removed(client, `/event-attendee-registrations/${primaryId}`, primaryId, opts, "Anmeldung");
  else if (sub === "aggregate") emit(await client.get("event", `/club-event-invitations/${primaryId}/aggregate`), opts.json, "Bestell-Aggregat");
  else throw new Error(`Unbekannte event-registration-Aktion "${sub}". Verfügbar: list, add, stats, show, update, adjust, delete, aggregate`);
  return true;
}

async function handleBudget({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const eventId = requireId(id, `event budget ${sub ?? ""}`, "event-id");
  if (sub === "show") emit(await client.get("event", `/events/budget-link/${eventId}`), opts.json, "Budget-Link");
  else if (sub === "set") emit(await client.post("event", "/events/budget-link/", { ...bodyFile(opts, "event budget set"), event_id: eventId, club_id: clubId }), opts.json, "Budget verknüpft");
  else if (sub === "delete") await removed(client, `/events/budget-link/${eventId}`, eventId, opts, "Budget-Link");
  else throw new Error(`Unbekannte event-budget-Aktion "${sub}". Verfügbar: show, set, delete`);
  return true;
}

async function handleDesign({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const eventId = requireId(id, `event design ${sub ?? ""}`, "event-id");
  if (sub === "theme-show") emit(await client.get("event", `/events/${eventId}/design/theme`), opts.json, "Event-Theme");
  else if (sub === "theme-set") emit(await client.put("event", `/events/${eventId}/design/theme`, { ...bodyFile(opts, "event design theme-set"), event_id: eventId, club_id: clubId }), opts.json, "Event-Theme gesetzt");
  else if (sub === "theme-delete") await removed(client, `/events/${eventId}/design/theme`, eventId, opts, "Event-Theme");
  else if (sub === "asset-list") emit(await client.get("event", `/events/${eventId}/design/assets`), opts.json, "Design-Assets");
  else if (sub === "asset-upload") {
    if (!opts.file || !opts.assetType) throw new Error("event design asset-upload benötigt --file <bild> und --asset-type FLYER|TITLE_PICTURE.");
    const form = new FormData();
    form.append("asset_type", opts.assetType);
    form.append("file", new Blob([readFileSync(opts.file)]), basename(opts.file));
    emit(await client.postForm("event", `/events/${eventId}/design/assets/upload`, form), opts.json, "Design-Asset hochgeladen");
  } else if (sub === "asset-delete") {
    const assetId = opts.assetId ?? opts.attachmentId;
    if (!assetId) throw new Error("event design asset-delete benötigt --asset-id <asset-id>.");
    await removed(client, `/events/${eventId}/design/assets/${assetId}`, assetId, opts, "Design-Asset");
  } else throw new Error(`Unbekannte event-design-Aktion "${sub}". Verfügbar: theme-show, theme-set, theme-delete, asset-list, asset-upload, asset-delete`);
  return true;
}

async function handleCopy({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const eventId = requireId(id, `event copy ${sub ?? ""}`, "event-id");
  if (sub === "set") emit(await client.patch("event", `/events/${eventId}/public-hub-copy`, bodyFile(opts, "event copy set")), opts.json, "Public-Hub-Texte aktualisiert");
  else if (sub === "reset") {
    if (!opts.key) throw new Error("event copy reset benötigt --key <copy-key>.");
    await removed(client, `/events/${eventId}/public-hub-copy/${encodeURIComponent(opts.key)}`, opts.key, opts, "Public-Hub-Text");
  } else throw new Error(`Unbekannte event-copy-Aktion "${sub}". Verfügbar: set, reset`);
  return true;
}

async function handleDj({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const primaryId = requireId(id, `event dj ${sub ?? ""}`, sub === "request-status" ? "request-id" : "event-id");
  if (sub === "settings") emit(await client.get("event", `/public/events/${primaryId}/dj/settings`), opts.json, "DJ-Einstellungen");
  else if (sub === "requests") emit(await client.get("event", `/public/events/${primaryId}/dj/requests`), opts.json, "DJ-Warteschlange");
  else if (sub === "settings-set") emit(await client.patch("event", `/events/${primaryId}/dj/settings`, bodyFile(opts, "event dj settings-set")), opts.json, "DJ-Einstellungen aktualisiert");
  else if (sub === "request-status") {
    if (!opts.status && !opts.file) throw new Error("event dj request-status benötigt --status played|rejected oder --file.");
    emit(await client.patch("event", `/events/dj/requests/${primaryId}/status`, opts.file ? bodyFile(opts, "event dj request-status") : { status: opts.status }), opts.json, "Songwunsch aktualisiert");
  } else if (sub === "reset") emit(await client.post("event", `/events/${primaryId}/dj/requests/reset`), opts.json, "DJ-Warteschlange geleert");
  else throw new Error(`Unbekannte event-dj-Aktion "${sub}". Verfügbar: settings, requests, settings-set, request-status, reset`);
  return true;
}

async function handleExternalSync({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  if (sub === "list") emit(await client.get("event", `/external-team-syncs/by-club/${id ?? clubId}`), opts.json, "Externe Team-Synchronisationen");
  else if (sub === "add") emit(await client.post("event", "/external-team-syncs/", withClub(bodyFile(opts, "event external-sync add"), clubId)), opts.json, "Synchronisation angelegt");
  else if (sub === "show") emit(await client.get("event", `/external-team-syncs/${requireId(id, "event external-sync show", "sync-id")}`), opts.json, "Synchronisation");
  else if (sub === "update") emit(await client.patch("event", `/external-team-syncs/${requireId(id, "event external-sync update", "sync-id")}`, bodyFile(opts, "event external-sync update")), opts.json, "Synchronisation aktualisiert");
  else if (sub === "delete") {
    const syncId = requireId(id, "event external-sync delete", "sync-id");
    await removed(client, `/external-team-syncs/${syncId}`, syncId, opts, "Synchronisation");
  } else if (sub === "matches") emit(await client.get("event", `/external-team-syncs/${requireId(id, "event external-sync matches", "sync-id")}/matches`), opts.json, "Synchronisierte Spiele");
  else if (sub === "run") emit(await client.post("event", `/external-team-syncs/sync/${id ?? clubId}`), opts.json, "Synchronisation ausgeführt");
  else if (sub === "stats") emit(await client.get("event", `/external-team-syncs/stats/${id ?? clubId}`), opts.json, "Team-Statistiken");
  else if (sub === "provider-run") {
    if (!opts.provider) throw new Error("event external-sync provider-run benötigt --provider <provider-id>.");
    emit(await client.post("event", `/external-team-syncs/sync/by-provider/${encodeURIComponent(opts.provider)}`), opts.json, "Provider synchronisiert");
  } else throw new Error(`Unbekannte event-external-sync-Aktion "${sub}". Siehe docs/veranstaltungen.md.`);
  return true;
}

async function handleInstance({ sub, id, opts, client }: HandlerArgs): Promise<boolean> {
  const eventId = requireId(id, `event instance ${sub ?? ""}`, "event-id");
  if (sub === "previous") emit(await client.get("event", `/events/${eventId}/previous-instance`), opts.json, "Vorherige Serieninstanz");
  else if (sub === "next") emit(await client.get("event", `/events/${eventId}/next-instance`), opts.json, "Nächste Serieninstanz");
  else if (sub === "compare") emit(await client.get("event", `/events/${eventId}/series-compare`), opts.json, "Serienvergleich");
  else if (sub === "clone-next") {
    const body = opts.file
      ? bodyFile(opts, "event instance clone-next")
      : opts.startTime
        ? { start_time: opts.startTime }
        : null;
    if (!body) throw new Error("event instance clone-next benötigt --start-time <iso> oder --file.");
    emit(await client.post("event", `/events/${eventId}/clone-as-next-instance`, body), opts.json, "Folgeinstanz angelegt");
  }
  else throw new Error(`Unbekannte event-instance-Aktion "${sub}". Verfügbar: previous, next, compare, clone-next`);
  return true;
}

async function handleChild({ sub, id, opts, client, clubId }: HandlerArgs): Promise<boolean> {
  const parentId = requireId(id, `event child ${sub ?? ""}`, "parent-event-id");
  if (sub === "list") emit(await client.get("event", `/events/${parentId}/children`), opts.json, "Festtage/Child-Events");
  else if (sub === "create") emit(await client.post("event", `/events/${parentId}/children`, withClub(bodyFile(opts, "event child create"), clubId)), opts.json, "Festtag angelegt");
  else if (sub === "invitation-summary") emit(await client.get("event", `/events/${parentId}/child-invitation-summary`), opts.json, "Einladungsübersicht der Festtage");
  else throw new Error(`Unbekannte event-child-Aktion "${sub}". Verfügbar: list, create, invitation-summary`);
  return true;
}

/**
 * Handles Event-Hub subresources that are not part of the compact core dispatcher.
 * Returns false for actions that the caller still handles itself (area list/add,
 * program list/add, templates, series, menu and core event CRUD).
 */
export async function handleEventOperation(args: HandlerArgs): Promise<boolean> {
  switch (args.action) {
    case "area": return handleArea(args);
    case "assignment": return handleAssignment(args);
    case "lead": return handleLead(args);
    case "area-note": return handleAreaNote(args);
    case "program": return handleProgram(args);
    case "contact": return handleContact(args);
    case "resource": return handleResource(args);
    case "attachment": return handleAttachment(args);
    case "tag": return handleTag(args);
    case "sponsor": return handleSponsor(args);
    case "sponsor-program": return handleSponsorProgram(args);
    case "invitation": return handleInvitation(args);
    case "club-invitation": return handleClubInvitation(args);
    case "registration": return handleRegistration(args);
    case "budget": return handleBudget(args);
    case "design": return handleDesign(args);
    case "copy": return handleCopy(args);
    case "dj": return handleDj(args);
    case "external-sync": return handleExternalSync(args);
    case "instance": return handleInstance(args);
    case "child": return handleChild(args);
    default: return false;
  }
}
