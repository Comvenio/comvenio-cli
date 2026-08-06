import type {
  JsonValue,
  RequestContext,
} from "@comvenio/connector-contracts";
import type {
  ComvenioApiClient,
  ComvenioHttpMethod,
} from "@comvenio/comvenio-client";

import {
  redactAssignment,
  redactClubSettings,
  redactMemberDetail,
  redactMemberList,
  redactMemberListItem,
  redactPermissionMatrix,
  redactPositionRole,
  redactWhoami,
} from "./privacy.ts";
import type { K7ActionHandler, K7ActionId } from "./types.ts";

type JsonObject = { [key: string]: JsonValue };

function record(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Die validierte Adaptereingabe ist kein Objekt.");
  }
  return value;
}

function nested(value: JsonValue, key: string): JsonObject {
  const candidate = record(value)[key];
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") {
    throw new Error(`Die validierte Adaptereingabe enthält kein Objekt ${key}.`);
  }
  return candidate;
}

function string(value: JsonValue, key: string): string {
  const candidate = record(value)[key];
  if (typeof candidate !== "string") throw new Error(`Die validierte Adaptereingabe enthält kein ${key}.`);
  return candidate;
}

function without(source: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

async function request(
  client: ComvenioApiClient,
  context: RequestContext,
  method: ComvenioHttpMethod,
  service: string,
  path: string,
  options: { query?: Record<string, string>; body?: JsonValue } = {},
): Promise<JsonValue> {
  return client.request({ method, service, path, context, ...options });
}

async function mutableRole(
  client: ComvenioApiClient,
  context: RequestContext,
  roleId: string,
): Promise<JsonObject> {
  const current = await request(client, context, "GET", "role", `/roles/${roleId}`);
  const role = record(current);
  if (role.is_protected === true) {
    throw new Error("Geschützte Rollen dürfen nicht verändert werden.");
  }
  return role;
}

function rows(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("Der Fachservice hat keine Liste geliefert.");
  return value;
}

function permissionRecord(value: JsonValue): Record<string, boolean> {
  const entries = rows(value).map((entry) => {
    const item = record(entry);
    if (typeof item.permission_key !== "string" || typeof item.allowed !== "boolean") {
      throw new Error("Der Fachservice hat eine ungültige Permission geliefert.");
    }
    return [item.permission_key, item.allowed] as const;
  });
  return Object.fromEntries(entries);
}

async function currentPermissionMatrix(
  client: ComvenioApiClient,
  context: RequestContext,
  roleId: string,
): Promise<Record<string, boolean>> {
  const [current, definitions] = await Promise.all([
    request(client, context, "GET", "role", `/permissions/by-role/${roleId}`),
    request(client, context, "GET", "role", "/permission-definitions/"),
  ]);
  const currentValues = permissionRecord(current);
  for (const definition of rows(definitions)) {
    const key = record(definition).key;
    if (typeof key === "string" && !(key in currentValues)) currentValues[key] = false;
  }
  return Object.fromEntries(Object.entries(currentValues).sort(([left], [right]) => left.localeCompare(right)));
}

function valuesRecord(value: JsonValue): Record<string, boolean> {
  return Object.fromEntries(rows(value).map((entry) => {
    const item = record(entry);
    if (typeof item.permission_key !== "string" || typeof item.allowed !== "boolean") {
      throw new Error("Die validierte Permission-Matrix ist ungültig.");
    }
    return [item.permission_key, item.allowed] as const;
  }));
}

const handlers: Partial<Record<K7ActionId, K7ActionHandler>> = {
  async "cai.whoami.01.whoami"(_input, context, client) {
    return redactWhoami(await request(client, context, "GET", "user", "/users/me"), context);
  },

  async "cai.club.02.update"(input, context, client) {
    const clubId = string(input, "club_id");
    return request(client, context, "PUT", "club", `/clubs/${clubId}`, { body: nested(input, "changes") });
  },
  async "cai.club.03.settings"(input, context, client) {
    const result = await request(client, context, "GET", "club", `/clubs/${string(input, "club_id")}/settings`);
    return redactClubSettings(result);
  },
  async "cai.club.04.settings_update"(input, context, client) {
    const result = await request(client, context, "PUT", "club", `/clubs/${string(input, "club_id")}/settings`, {
      body: nested(input, "settings"),
    });
    return redactClubSettings(result);
  },
  async "cai.club.05.design"(input, context, client) {
    const result = await request(client, context, "PUT", "club", `/clubs/${string(input, "club_id")}/settings`, {
      body: { design_settings: nested(input, "design_settings") },
    });
    return redactClubSettings(result);
  },
  async "cai.club.06.department_list"(input, context, client) {
    const data = record(input);
    const suffix = data.tree === true ? "/tree" : "";
    return request(client, context, "GET", "club", `/departments/by_club/${string(input, "club_id")}${suffix}`);
  },
  async "cai.club.07.department_show"(input, context, client) {
    return request(client, context, "GET", "club", `/departments/by_dep_id/${string(input, "department_id")}`);
  },
  async "cai.club.08.department_add"(input, context, client) {
    return request(client, context, "POST", "club", `/departments/${string(input, "club_id")}`, {
      body: nested(input, "department"),
    });
  },
  async "cai.club.09.department_update"(input, context, client) {
    return request(client, context, "PUT", "club", `/departments/${string(input, "department_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.club.10.department_delete"(input, context, client) {
    const id = string(input, "department_id");
    await request(client, context, "DELETE", "club", `/departments/${id}`);
    return { deleted: true, id };
  },

  async "cai.member.01.list"(input, context, client) {
    const data = record(input);
    const limit = data.limit as number;
    const offset = data.offset as number;
    const result = await request(client, context, "GET", "member", `/members/by_club/${string(input, "club_id")}`, {
      query: { limit: String(limit), offset: String(offset) },
    });
    return redactMemberList(result, { limit, offset });
  },
  async "cai.member.02.show"(input, context, client) {
    return redactMemberDetail(await request(client, context, "GET", "member", `/members/${string(input, "member_id")}`));
  },
  async "cai.member.03.add"(input, context, client) {
    const result = await request(client, context, "POST", "member", "/members/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "member") },
    });
    return redactMemberListItem(result);
  },
  async "cai.member.04.update"(input, context, client) {
    const result = await request(client, context, "PATCH", "member", `/members/${string(input, "member_id")}`, {
      body: nested(input, "changes"),
    });
    return redactMemberListItem(result);
  },
  async "cai.member.05.remove"(input, context, client) {
    const id = string(input, "member_id");
    await request(client, context, "DELETE", "member", `/members/${id}`);
    return { deleted: true, id };
  },
  async "cai.member.07.family_list"(input, context, client) {
    return request(client, context, "GET", "member", `/families/by_club/${string(input, "club_id")}`);
  },
  async "cai.member.08.family_show"(input, context, client) {
    return request(client, context, "GET", "member", `/families/${string(input, "family_id")}`);
  },
  async "cai.member.09.family_add"(input, context, client) {
    return request(client, context, "POST", "member", "/families/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "family") },
    });
  },
  async "cai.member.10.family_update"(input, context, client) {
    return request(client, context, "PATCH", "member", `/families/${string(input, "family_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.member.11.family_delete"(input, context, client) {
    const id = string(input, "family_id");
    await request(client, context, "DELETE", "member", `/families/${id}`);
    return { deleted: true, id };
  },
  async "cai.member.12.status_list"(input, context, client) {
    return request(client, context, "GET", "member", `/membership-status/by_club/${string(input, "club_id")}`);
  },
  async "cai.member.13.status_show"(input, context, client) {
    return request(client, context, "GET", "member", `/membership-status/${string(input, "status_id")}`);
  },
  async "cai.member.14.status_add"(input, context, client) {
    return request(client, context, "POST", "member", "/membership-status/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "status") },
    });
  },
  async "cai.member.15.status_update"(input, context, client) {
    return request(client, context, "PATCH", "member", `/membership-status/${string(input, "status_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.member.16.status_delete"(input, context, client) {
    const id = string(input, "status_id");
    await request(client, context, "DELETE", "member", `/membership-status/${id}`);
    return { deleted: true, id };
  },
  async "cai.member.17.period_list"(input, context, client) {
    return request(client, context, "GET", "member", `/membership-periods/member/${string(input, "member_id")}`);
  },
  async "cai.member.18.period_show"(input, context, client) {
    return request(client, context, "GET", "member", `/membership-periods/${string(input, "period_id")}`);
  },
  async "cai.member.19.period_add"(input, context, client) {
    return request(client, context, "POST", "member", "/membership-periods/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "period") },
    });
  },
  async "cai.member.20.period_update"(input, context, client) {
    return request(client, context, "PATCH", "member", `/membership-periods/${string(input, "period_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.member.21.period_delete"(input, context, client) {
    const id = string(input, "period_id");
    await request(client, context, "DELETE", "member", `/membership-periods/${id}`);
    return { deleted: true, id };
  },

  async "cai.team.01.list"(input, context, client) {
    return request(client, context, "GET", "member", `/teams/by-club/${string(input, "club_id")}`);
  },
  async "cai.team.02.show"(input, context, client) {
    return request(client, context, "GET", "member", `/teams/${string(input, "team_id")}`);
  },
  async "cai.team.03.create"(input, context, client) {
    return request(client, context, "POST", "member", "/teams/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "team") },
    });
  },
  async "cai.team.04.update"(input, context, client) {
    return request(client, context, "PATCH", "member", `/teams/${string(input, "team_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.team.05.delete"(input, context, client) {
    const id = string(input, "team_id");
    await request(client, context, "DELETE", "member", `/teams/${id}`);
    return { deleted: true, id };
  },
  async "cai.team.06.member_list_add_update_remove"(input, context, client) {
    const data = record(input);
    const teamId = string(input, "team_id");
    if (data.operation === "list") {
      return { operation: "list", items: await request(client, context, "GET", "member", `/teams/${teamId}/members`) } as JsonValue;
    }
    const memberId = string(input, "member_id");
    if (data.operation === "add") {
      const item = await request(client, context, "POST", "member", `/teams/${teamId}/members`, {
        body: without(data, ["operation", "club_id", "team_id"]),
      });
      return { operation: "add", item } as JsonValue;
    }
    if (data.operation === "update") {
      const item = await request(client, context, "PATCH", "member", `/teams/${teamId}/members/${memberId}`, {
        body: nested(input, "changes"),
      });
      return { operation: "update", item } as JsonValue;
    }
    await request(client, context, "DELETE", "member", `/teams/${teamId}/members/${memberId}`);
    return { operation: "remove", deleted: true, team_id: teamId, member_id: memberId } as JsonValue;
  },
  async "cai.team.07.resource_list_add_update_remove"(input, context, client) {
    const data = record(input);
    const teamId = string(input, "team_id");
    if (data.operation === "list") {
      return { operation: "list", items: await request(client, context, "GET", "member", `/teams/${teamId}/resource-priorities`) } as JsonValue;
    }
    if (data.operation === "add") {
      const item = await request(client, context, "POST", "member", `/teams/${teamId}/resource-priorities`, {
        body: without(data, ["operation", "club_id", "team_id"]),
      });
      return { operation: "add", item } as JsonValue;
    }
    const priorityId = string(input, "priority_id");
    if (data.operation === "update") {
      const item = await request(client, context, "PATCH", "member", `/teams/${teamId}/resource-priorities/${priorityId}`, {
        body: nested(input, "changes"),
      });
      return { operation: "update", item } as JsonValue;
    }
    await request(client, context, "DELETE", "member", `/teams/${teamId}/resource-priorities/${priorityId}`);
    return { operation: "remove", deleted: true, id: priorityId } as JsonValue;
  },

  // ── Saisonale Mannschaften (K9) — mirrors `comvenio teams` 1:1 ──
  async "cai.teams.01.list"(input, context, client) {
    const data = record(input);
    if (typeof data.department_id === "string") {
      const suffix = data.include_descendants === true ? "?include_descendants=true" : "";
      return request(client, context, "GET", "member", `/teams/by-department/${data.department_id}${suffix}`);
    }
    return request(client, context, "GET", "member", `/teams/by-club/${string(input, "club_id")}`);
  },
  async "cai.teams.02.show"(input, context, client) {
    return request(client, context, "GET", "member", `/teams/${string(input, "team_id")}`);
  },
  async "cai.teams.03.create"(input, context, client) {
    return request(client, context, "POST", "member", "/teams/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "team") },
    });
  },
  async "cai.teams.04.update"(input, context, client) {
    return request(client, context, "PATCH", "member", `/teams/${string(input, "team_id")}`, {
      body: nested(input, "changes"),
    });
  },
  async "cai.teams.05.archive"(input, context, client) {
    // Archive is the sanctioned end state — hard delete stays CLI-/tool-free
    // for teams with history (backend 409 TEAM_HAS_HISTORY_USE_ARCHIVE).
    return request(client, context, "PATCH", "member", `/teams/${string(input, "team_id")}`, {
      body: { archived_at: new Date().toISOString() },
    });
  },
  async "cai.teams.06.season_list"(input, context, client) {
    return request(client, context, "GET", "member", `/teams/${string(input, "team_id")}/seasons`);
  },
  async "cai.teams.07.season_create"(input, context, client) {
    return request(client, context, "POST", "member", `/teams/${string(input, "team_id")}/seasons`, {
      body: nested(input, "season"),
    });
  },
  async "cai.teams.08.season_correct"(input, context, client) {
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/historical-corrections`, {
        body: { reason: string(input, "reason"), patch: nested(input, "patch") },
      });
  },
  async "cai.teams.09.season_activate"(input, context, client) {
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/transitions/activate`);
  },
  async "cai.teams.10.season_complete"(input, context, client) {
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/transitions/complete`);
  },
  async "cai.teams.11.roster_list"(input, context, client) {
    return request(client, context, "GET", "member",
      `/team-seasons/${string(input, "team_season_id")}/members`);
  },
  async "cai.teams.12.roster_add"(input, context, client) {
    const data = record(input);
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/members`, {
        body: without(data, ["club_id", "team_season_id"]),
      });
  },
  async "cai.teams.13.roster_update"(input, context, client) {
    return request(client, context, "PATCH", "member",
      `/team-season-members/${string(input, "roster_id")}`, {
        body: nested(input, "changes"),
      });
  },
  async "cai.teams.14.roster_remove"(input, context, client) {
    const rosterId = string(input, "roster_id");
    await request(client, context, "DELETE", "member", `/team-season-members/${rosterId}`);
    return { removed: true, roster_id: rosterId };
  },
  async "cai.teams.15.roster_carry_over_preview"(input, context, client) {
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/roster-preview`, {
        body: { source_season_id: string(input, "source_season_id") },
      });
  },
  async "cai.teams.16.roster_carry_over"(input, context, client) {
    const data = record(input);
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/roster-carry-over`, {
        body: { source_season_id: string(input, "source_season_id"), member_ids: data.member_ids ?? [] },
      });
  },
  async "cai.teams.17.competition_list"(input, context, client) {
    return request(client, context, "GET", "member",
      `/team-seasons/${string(input, "team_season_id")}/competitions`);
  },
  async "cai.teams.18.competition_create"(input, context, client) {
    return request(client, context, "POST", "member",
      `/team-seasons/${string(input, "team_season_id")}/competitions`, {
        body: nested(input, "competition"),
      });
  },
  async "cai.teams.19.competition_update"(input, context, client) {
    return request(client, context, "PATCH", "member",
      `/team-season-competitions/${string(input, "competition_id")}`, {
        body: nested(input, "changes"),
      });
  },
  async "cai.teams.20.competition_delete"(input, context, client) {
    const competitionId = string(input, "competition_id");
    await request(client, context, "DELETE", "member", `/team-season-competitions/${competitionId}`);
    return { deleted: true, competition_id: competitionId };
  },
  async "cai.teams.21.ical_list"(input, context, client) {
    return request(client, context, "GET", "event",
      `/team-seasons/${string(input, "team_season_id")}/calendar-subscriptions`);
  },
  async "cai.teams.22.ical_create"(input, context, client) {
    // AK-N-02: the raw URL only travels in the request body; the response
    // schema exposes masked_url exclusively.
    return request(client, context, "POST", "event",
      `/team-seasons/${string(input, "team_season_id")}/calendar-subscriptions`, {
        body: { url: string(input, "url") },
      });
  },
  async "cai.teams.23.ical_preview"(input, context, client) {
    return request(client, context, "POST", "event",
      `/calendar-subscriptions/${string(input, "subscription_id")}/preview`);
  },
  async "cai.teams.24.ical_activate"(input, context, client) {
    const data = record(input);
    return request(client, context, "POST", "event",
      `/calendar-subscriptions/${string(input, "subscription_id")}/activate`, {
        body: { preview_token: string(input, "preview_token"), mappings: data.mappings ?? {} },
      });
  },
  async "cai.teams.25.ical_deactivate"(input, context, client) {
    return request(client, context, "POST", "event",
      `/calendar-subscriptions/${string(input, "subscription_id")}/deactivate`);
  },
  async "cai.teams.26.sync_now"(input, context, client) {
    return request(client, context, "POST", "event",
      `/calendar-subscriptions/${string(input, "subscription_id")}/sync`);
  },
  async "cai.teams.27.sync_runs"(input, context, client) {
    const data = record(input);
    return request(client, context, "GET", "event",
      `/calendar-subscriptions/${string(input, "subscription_id")}/runs`, {
        query: { limit: String(data.limit), offset: String(data.offset) },
      });
  },
  async "cai.teams.28.clarification_list"(input, context, client) {
    return request(client, context, "GET", "event",
      `/team-seasons/${string(input, "team_season_id")}/sync-clarifications`);
  },
  async "cai.teams.29.clarification_resolve"(input, context, client) {
    return request(client, context, "POST", "event",
      `/sync-clarifications/${string(input, "clarification_id")}/resolve`, {
        body: nested(input, "resolution"),
      });
  },

  async "cai.role.01.list"(input, context, client) {
    return request(client, context, "GET", "role", `/roles/by-club/${string(input, "club_id")}`);
  },
  async "cai.role.02.show"(input, context, client) {
    return request(client, context, "GET", "role", `/roles/${string(input, "role_id")}`);
  },
  async "cai.role.03.create"(input, context, client) {
    return request(client, context, "POST", "role", "/roles/", {
      body: { club_id: string(input, "club_id"), ...nested(input, "role") },
    });
  },
  async "cai.role.04.update"(input, context, client) {
    const roleId = string(input, "role_id");
    await mutableRole(client, context, roleId);
    return request(client, context, "PATCH", "role", `/roles/${roleId}`, { body: nested(input, "changes") });
  },
  async "cai.role.05.delete"(input, context, client) {
    const id = string(input, "role_id");
    await mutableRole(client, context, id);
    await request(client, context, "DELETE", "role", `/roles/${id}`);
    return { deleted: true, id };
  },
  async "cai.role.06.permission_defs"(_input, context, client) {
    return request(client, context, "GET", "role", "/permission-definitions/");
  },
  async "cai.role.07.permission_set"(input, context, client) {
    const data = record(input);
    const roleId = string(input, "role_id");
    await mutableRole(client, context, roleId);
    const before = await currentPermissionMatrix(client, context, roleId);
    const result = await request(client, context, "POST", "role", `/roles/${roleId}/permissions/apply`, {
      body: {
        values: { [string(input, "permission_key")]: data.allowed as boolean },
        replace: false,
        expected_before: before,
      },
    });
    return redactPermissionMatrix(result);
  },
  async "cai.role.08.permissions_show_apply"(input, context, client) {
    const data = record(input);
    const roleId = string(input, "role_id");
    if (data.operation === "show") {
      return { operation: "show", permissions: await request(client, context, "GET", "role", `/permissions/by-role/${roleId}`) } as JsonValue;
    }
    await mutableRole(client, context, roleId);
    const before = await currentPermissionMatrix(client, context, roleId);
    const supplied = valuesRecord(data.values!);
    const replace = data.replace === true;
    const values = replace
      ? Object.fromEntries(Object.keys(before).map((key) => [key, supplied[key] ?? false]))
      : supplied;
    const result = await request(client, context, "POST", "role", `/roles/${roleId}/permissions/apply`, {
      body: { values, replace, expected_before: before },
    });
    return { operation: "apply", result: redactPermissionMatrix(result) } as JsonValue;
  },
  async "cai.role.09.assign"(input, context, client) {
    const data = record(input);
    const clubId = string(input, "club_id");
    const memberId = string(input, "member_id");
    await request(client, context, "GET", "role", `/member-role-assignments/by-member/${memberId}`, {
      query: { club_id: clubId },
    });
    const result = await request(client, context, "POST", "role", "/member-role-assignments/", {
      body: {
        club_id: clubId,
        member_id: memberId,
        role_id: string(input, "role_id"),
        scope: string(input, "scope"),
        department_id: data.department_id ?? null,
      },
    });
    return redactAssignment(result);
  },
  async "cai.role.10.unassign"(input, context, client) {
    const id = string(input, "assignment_id");
    await request(client, context, "GET", "role", `/member-role-assignments/by_id/${id}`);
    await request(client, context, "DELETE", "role", `/member-role-assignments/${id}`);
    return { deleted: true, id };
  },
  async "cai.role.11.assignments"(input, context, client) {
    const selector = nested(input, "selector");
    let path: string;
    let query: Record<string, string> | undefined;
    if (selector.type === "role") path = `/member-role-assignments/by-role/${selector.role_id}`;
    else if (selector.type === "member") {
      path = `/member-role-assignments/by-member/${selector.member_id}`;
      query = { club_id: string(input, "club_id") };
    } else if (selector.type === "department") path = `/member-role-assignments/by-department/${selector.department_id}`;
    else path = `/member-role-assignments/by-club/${string(input, "club_id")}`;
    return rows(await request(client, context, "GET", "role", path, { query })).map(redactAssignment);
  },
  async "cai.role.12.position_link"(input, context, client) {
    const data = record(input);
    const positionId = string(input, "position_id");
    await request(client, context, "GET", "role", `/position-roles/by-position/${positionId}`);
    const result = await request(client, context, "POST", "role", "/position-roles/", {
      body: {
        club_id: string(input, "club_id"),
        position_id: positionId,
        role_id: string(input, "role_id"),
        department_id: data.department_id ?? null,
      },
    });
    return redactPositionRole(result);
  },
  async "cai.role.13.position_unlink"(input, context, client) {
    const id = string(input, "assignment_id");
    await request(client, context, "GET", "role", `/position-roles/${id}`);
    await request(client, context, "DELETE", "role", `/position-roles/${id}`);
    return { deleted: true, id };
  },
  async "cai.role.14.position_list"(input, context, client) {
    return rows(await request(client, context, "GET", "role", `/position-roles/by-position/${string(input, "position_id")}`))
      .map(redactPositionRole);
  },
};

export const K7_ACTION_HANDLERS = Object.freeze(handlers);
