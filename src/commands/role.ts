import type { CAC } from "cac";
import { randomUUID } from "node:crypto";

import { loadState } from "../auth.ts";
import { output, renderTable } from "../format.ts";
import { createClient, type ComvenioClient } from "../http.ts";
import { requireClubId } from "../util/club.ts";
import { prune } from "../util/body.ts";
import { readJsonFile } from "../util/file.ts";

type RoleRead = {
  id: string;
  club_id: string;
  name: string;
  description?: string | null;
  is_protected: boolean;
  is_active?: boolean;
  deleted_at?: string | null;
};

type PermissionRead = {
  id: string;
  role_id: string;
  permission_key: string;
  allowed: boolean;
};

type PermissionDefinitionRead = {
  key: string;
  description: string;
  module: string;
};

type AssignmentRead = {
  id: string;
  club_id: string;
  member_id: string;
  role_id: string;
  scope: "club" | "department";
  department_id?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  role?: RoleRead | null;
  is_active?: boolean;
  deleted_at?: string | null;
};

type PositionRoleRead = {
  id: string;
  club_id: string;
  position_id: string;
  role_id: string;
  department_id?: string | null;
  role?: RoleRead | null;
  is_active?: boolean;
  deleted_at?: string | null;
};

type EffectivePermissionSource = {
  permission_key: string;
  allowed: boolean;
  role_id: string;
  source_role_id: string;
  role_name: string;
  scope: "club" | "department";
  department_id?: string | null;
  assignment_type: "direct" | "position";
  assignment_id: string;
  source_id?: string | null;
};

type EffectivePermissionRead = {
  member_id: string;
  club_id: string;
  department_id?: string | null;
  permissions: Record<string, boolean>;
  sources: EffectivePermissionSource[];
};

type MatrixApplyResult = {
  role_id: string;
  mode: "patch" | "replace";
  before: Record<string, boolean>;
  after: Record<string, boolean>;
  changed: string[];
  changes: Array<{ permission_key: string; before: boolean; after: boolean }>;
};

export type PermissionApplication =
  | {
      kind: "preview";
      preview: ReturnType<typeof buildReplacePreview>;
      runId: string;
    }
  | {
      kind: "applied";
      result: MatrixApplyResult;
      preview?: ReturnType<typeof buildReplacePreview>;
      runId: string;
    };

export type MutationEvidence = {
  run_id: string;
  target: Record<string, unknown>;
  current: unknown;
  diff: unknown;
  risk: string;
};

export type RoleCommandOpts = {
  json?: boolean;
  club?: string;
  name?: string;
  description?: string;
  roleId?: string;
  memberId?: string;
  scope?: string;
  departmentId?: string;
  positionId?: string;
  permissionKey?: string;
  allowed?: string;
  file?: string;
  replace?: boolean;
  yes?: boolean;
};

export function parseAllowed(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("--allowed erwartet true oder false.");
}

export function buildRoleAssignmentBody(
  clubId: string,
  opts: RoleCommandOpts,
): Record<string, unknown> {
  if (!opts.memberId || !opts.roleId) {
    throw new Error("role assign benötigt --member-id und --role-id.");
  }
  if (opts.scope !== "club" && opts.scope !== "department") {
    throw new Error("role assign benötigt --scope club|department.");
  }
  if (opts.scope === "department" && !opts.departmentId) {
    throw new Error("--scope department benötigt --department-id.");
  }
  if (opts.scope === "club" && opts.departmentId) {
    throw new Error("--scope club darf nicht mit --department-id kombiniert werden.");
  }
  return {
    club_id: clubId,
    member_id: opts.memberId,
    role_id: opts.roleId,
    scope: opts.scope,
    department_id: opts.scope === "department" ? opts.departmentId : undefined,
  };
}

export function parsePermissionMatrix(path: string): Record<string, boolean> {
  const raw = readJsonFile<unknown>(path);
  const candidate = (
    raw && typeof raw === "object" && !Array.isArray(raw) && ("values" in raw || "permissions" in raw)
      ? (raw as { values?: unknown; permissions?: unknown }).values
        ?? (raw as { permissions?: unknown }).permissions
      : raw
  );
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Die Matrix-Datei muss ein JSON-Objekt mit Permission-Keys enthalten.");
  }
  const matrix: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value !== "boolean") {
      throw new Error(`Permission "${key}" muss true oder false sein.`);
    }
    matrix[key] = value;
  }
  return matrix;
}

export function buildReplacePreview(
  current: PermissionRead[],
  definitions: PermissionDefinitionRead[],
  replacement: Record<string, boolean>,
) {
  const keys = [...new Set([
    ...definitions.map((definition) => definition.key),
    ...current.map((permission) => permission.permission_key),
    ...Object.keys(replacement),
  ])].sort();
  const before = Object.fromEntries(keys.map((key) => [
    key,
    current.find((permission) => permission.permission_key === key)?.allowed ?? false,
  ]));
  const after = Object.fromEntries(keys.map((key) => [key, replacement[key] ?? false]));
  return {
    before,
    after,
    diff: keys.map((permission_key) => ({
      permission_key,
      before: before[permission_key]!,
      after: after[permission_key]!,
      changed: before[permission_key] !== after[permission_key],
    })),
  };
}

export function buildPatchPreview(
  current: PermissionRead[],
  definitions: PermissionDefinitionRead[],
  patch: Record<string, boolean>,
) {
  const keys = [...new Set([
    ...definitions.map((definition) => definition.key),
    ...current.map((permission) => permission.permission_key),
    ...Object.keys(patch),
  ])].sort();
  const before = Object.fromEntries(keys.map((key) => [
    key,
    current.find((permission) => permission.permission_key === key)?.allowed ?? false,
  ]));
  const after = { ...before, ...patch };
  return {
    before,
    after,
    diff: keys.map((permission_key) => ({
      permission_key,
      before: before[permission_key]!,
      after: after[permission_key]!,
      changed: before[permission_key] !== after[permission_key],
    })),
  };
}

export function emitMutationPreflight(evidence: MutationEvidence, json = false): void {
  const payload = { phase: "preflight", ...evidence };
  process.stderr.write(json
    ? `${JSON.stringify(payload)}\n`
    : `Preflight (vor Write):\n${JSON.stringify(payload, null, 2)}\n`);
}

export async function applyPermissions(
  client: Pick<ComvenioClient, "get" | "post">,
  roleId: string,
  opts: Pick<RoleCommandOpts, "file" | "replace" | "yes">,
  preflight?: (evidence: MutationEvidence) => void,
): Promise<PermissionApplication> {
  if (!opts.file) throw new Error("role permissions apply benötigt --file <matrix.json>.");
  const runId = randomUUID();
  const matrix = parsePermissionMatrix(opts.file);
  const [current, definitions] = await Promise.all([
    client.get<PermissionRead[]>("role", `/permissions/by-role/${roleId}`),
    client.get<PermissionDefinitionRead[]>("role", "/permission-definitions/"),
  ]);
  if (opts.replace) {
    const preview = buildReplacePreview(current, definitions, matrix);
    if (!opts.yes) return { kind: "preview", preview, runId };
    preflight?.({
      run_id: runId,
      target: { type: "permission_matrix", role_id: roleId },
      current: preview.before,
      diff: preview.diff,
      risk: "Vollersatz: Nicht gelieferte Permission-Keys werden false.",
    });
    const result = await client.post<MatrixApplyResult>(
      "role",
      `/roles/${roleId}/permissions/apply`,
      {
        values: matrix,
        replace: true,
        expected_before: preview.before,
      },
    );
    return { kind: "applied", result, preview, runId };
  }
  const preview = buildPatchPreview(current, definitions, matrix);
  preflight?.({
    run_id: runId,
    target: { type: "permission_matrix", role_id: roleId },
    current: preview.before,
    diff: preview.diff.filter((row) => row.changed),
    risk: "Patch: Nur gelieferte Permission-Keys werden geändert.",
  });
  const result = await client.post<MatrixApplyResult>(
    "role",
    `/roles/${roleId}/permissions/apply`,
    { values: matrix, replace: false, expected_before: preview.before },
  );
  return { kind: "applied", result, preview, runId };
}

export function ensureRoleIsMutable(role: Pick<RoleRead, "name" | "is_protected">): void {
  if (role.is_protected) {
    throw new Error(`Die geschützte Rolle "${role.name}" darf nicht verändert werden.`);
  }
}

async function mutableRole(client: ComvenioClient, roleId: string): Promise<RoleRead> {
  const role = await client.get<RoleRead>("role", `/roles/${roleId}`);
  ensureRoleIsMutable(role);
  return role;
}

function roleIdFrom(id: string | undefined, opts: RoleCommandOpts, command: string): string {
  const roleId = opts.roleId ?? id;
  if (!roleId) throw new Error(`${command} benötigt eine Rollen-ID oder --role-id.`);
  return roleId;
}

function assignmentTable(rows: AssignmentRead[]): string {
  return rows.length
    ? renderTable(rows, [
        { header: "Assignment-ID", width: 36, get: (row) => row.id },
        { header: "Mitglied", width: 36, get: (row) => row.member_id },
        { header: "Rolle", width: 24, get: (row) => row.role?.name ?? row.role_id },
        { header: "Scope", width: 12, get: (row) => row.scope },
        { header: "Abteilung", width: 36, get: (row) => row.department_id ?? "—" },
        { header: "Quelle", width: 10, get: (row) => row.source_type === "position_assignment" ? "position" : "direct" },
      ])
    : "Keine Rollenzuweisungen.";
}

export function registerRoleCommands(cli: CAC): void {
  cli
    .command(
      "role <action> [arg1] [arg2]",
      "Rollen und Rechte: CRUD, Matrix, Zuweisungen, Positionen und effektive Rechte",
    )
    .option("--club <id>", "Club-ID (sonst aus dem State-File)")
    .option("--name <name>", "Name einer Custom Role")
    .option("--description <text>", "Beschreibung einer Custom Role")
    .option("--role-id <id>", "Rollen-ID")
    .option("--member-id <id>", "Mitglieds-ID")
    .option("--scope <scope>", "Zuweisungs-Scope: club|department")
    .option("--department-id <id>", "Abteilungs-ID für Department-Scope")
    .option("--position-id <id>", "Positions-ID")
    .option("--permission-key <key>", "Technischer Permission-Key")
    .option("--allowed <boolean>", "Permission-Wert: true|false")
    .option("--file <path>", "JSON-Datei mit Permission-Matrix")
    .option("--replace", "Vollständiger Matrix-Ersatz; fehlende Keys werden false")
    .option("--yes", "Bestätigt einen vollständigen Matrix-Ersatz")
    .option("--json", "JSON-Ausgabe (maschinenlesbar)")
    .action(async (
      action: string,
      arg1: string | undefined,
      arg2: string | undefined,
      opts: RoleCommandOpts,
    ) => {
      const state = await loadState();
      const client = createClient(state);
      const clubId = requireClubId(state, opts.club);

      if (action === "list") {
        const roles = await client.get<RoleRead[]>("role", `/roles/by-club/${clubId}`);
        output(roles, opts.json, () => roles.length
          ? renderTable(roles, [
              { header: "ID", width: 36, get: (role) => role.id },
              { header: "Name", width: 28, get: (role) => role.name },
              { header: "Typ", width: 12, get: (role) => role.is_protected ? "geschützt" : "custom" },
              { header: "Beschreibung", width: 36, get: (role) => role.description ?? "—" },
            ])
          : "Keine Rollen.");
        return;
      }

      if (action === "show") {
        const roleId = roleIdFrom(arg1, opts, "role show");
        const role = await client.get<RoleRead>("role", `/roles/${roleId}`);
        output(role, opts.json, () => [
          `Rolle:        ${role.name}`,
          `ID:           ${role.id}`,
          `Typ:          ${role.is_protected ? "geschützt" : "custom"}`,
          `Beschreibung: ${role.description ?? "—"}`,
        ].join("\n"));
        return;
      }

      if (action === "create") {
        if (!opts.name) throw new Error("role create benötigt --name.");
        const role = await client.post<RoleRead>("role", "/roles/", prune({
          club_id: clubId,
          name: opts.name,
          description: opts.description,
        }));
        output(role, opts.json, () => `Custom Role angelegt: ${role.name} (${role.id})`);
        return;
      }

      if (action === "update") {
        const roleId = roleIdFrom(arg1, opts, "role update");
        await mutableRole(client, roleId);
        const body = prune({ name: opts.name, description: opts.description });
        if (!Object.keys(body).length) {
          throw new Error("role update benötigt --name oder --description.");
        }
        const role = await client.patch<RoleRead>("role", `/roles/${roleId}`, body);
        output(role, opts.json, () => `Custom Role aktualisiert: ${role.name} (${role.id})`);
        return;
      }

      if (action === "delete") {
        const roleId = roleIdFrom(arg1, opts, "role delete");
        const role = await mutableRole(client, roleId);
        const evidence = {
          run_id: randomUUID(),
          target: { type: "role", role_id: roleId, name: role.name },
          current: role,
          diff: {
            is_active: { before: role.is_active ?? true, after: false },
            deleted_at: { before: role.deleted_at ?? null, after: "server_timestamp" },
          },
          risk: "Soft-Delete: Die Rolle gewährt bis zu einem Restore keine Zugriffe.",
        };
        emitMutationPreflight(evidence, opts.json);
        await client.del("role", `/roles/${roleId}`);
        output(
          { ...evidence, deleted: roleId, restore_command: `comvenio role restore ${roleId}` },
          opts.json,
          () => `Custom Role soft-gelöscht: ${role.name} (${roleId}). Restore: comvenio role restore ${roleId}`,
        );
        return;
      }

      if (action === "restore") {
        const roleId = roleIdFrom(arg1, opts, "role restore");
        const current = await client.get<RoleRead>("role", `/roles/${roleId}/deleted`);
        ensureRoleIsMutable(current);
        const evidence = {
          run_id: randomUUID(),
          target: { type: "role", role_id: roleId, name: current.name },
          current,
          diff: {
            is_active: { before: false, after: true },
            deleted_at: { before: current.deleted_at, after: null },
          },
          risk: "Restore: Die Rolle und ihre vorhandenen Zuweisungen werden wieder wirksam.",
        };
        emitMutationPreflight(evidence, opts.json);
        const restored = await client.post<RoleRead>("role", `/roles/${roleId}/restore`, {});
        output({
          ...evidence,
          result: restored,
        }, opts.json, () => `Custom Role wiederhergestellt: ${restored.name} (${restored.id})`);
        return;
      }

      if (action === "permission-defs") {
        const definitions = await client.get<PermissionDefinitionRead[]>("role", "/permission-definitions/");
        output(definitions, opts.json, () => definitions.length
          ? renderTable(definitions, [
              { header: "Key", width: 32, get: (row) => row.key },
              { header: "Modul", width: 24, get: (row) => row.module },
              { header: "Beschreibung", width: 48, get: (row) => row.description },
            ])
          : "Keine Permission-Definitionen.");
        return;
      }

      if (action === "permission") {
        if (arg1 !== "set") throw new Error('role permission unterstützt nur "set".');
        const roleId = roleIdFrom(arg2, opts, "role permission set");
        if (!opts.permissionKey) throw new Error("role permission set benötigt --permission-key.");
        const permissionKey = opts.permissionKey;
        await mutableRole(client, roleId);
        const [current, definitions] = await Promise.all([
          client.get<PermissionRead[]>("role", `/permissions/by-role/${roleId}`),
          client.get<PermissionDefinitionRead[]>("role", "/permission-definitions/"),
        ]);
        const allowed = parseAllowed(opts.allowed);
        const preview = buildPatchPreview(current, definitions, { [permissionKey]: allowed });
        const evidence = {
          run_id: randomUUID(),
          target: { type: "permission", role_id: roleId, permission_key: permissionKey },
          current: preview.before,
          diff: preview.diff.filter((row) => row.changed),
          risk: "Ändert den effektiven Zugriff aller Mitglieder mit dieser Rolle.",
        };
        emitMutationPreflight(evidence, opts.json);
        const result = await client.post<MatrixApplyResult>(
          "role",
          `/roles/${roleId}/permissions/apply`,
          {
            values: { [permissionKey]: allowed },
            replace: false,
            expected_before: preview.before,
          },
        );
        output({
          ...evidence,
          ...result,
        }, opts.json, () =>
          `Permission ${permissionKey} auf ${result.after[permissionKey]} gesetzt.`,
        );
        return;
      }

      if (action === "permissions") {
        const sub = arg1;
        const roleId = roleIdFrom(arg2, opts, `role permissions ${sub ?? ""}`);
        if (sub === "show") {
          const rows = await client.get<PermissionRead[]>("role", `/permissions/by-role/${roleId}`);
          output(rows, opts.json, () => rows.length
            ? renderTable(rows, [
                { header: "Permission", width: 36, get: (row) => row.permission_key },
                { header: "Erlaubt", width: 9, get: (row) => row.allowed ? "ja" : "nein" },
                { header: "ID", width: 36, get: (row) => row.id },
              ])
            : "Keine Permissions für diese Rolle.");
          return;
        }
        if (sub !== "apply") {
          throw new Error('role permissions unterstützt "show" oder "apply".');
        }
        await mutableRole(client, roleId);
        const application = await applyPermissions(
          client,
          roleId,
          opts,
          (evidence) => emitMutationPreflight(evidence, opts.json),
        );
        if (application.kind === "preview") {
          const { preview } = application;
          output(
            {
              ...preview,
              run_id: application.runId,
              target: { type: "permission_matrix", role_id: roleId },
              current: preview.before,
              risk: "Vollersatz: Nicht gelieferte Permission-Keys werden false.",
              mode: "replace",
              confirmed: false,
            },
            opts.json,
            () => [
              renderTable(preview.diff, [
                { header: "Permission", width: 36, get: (row) => row.permission_key },
                { header: "Vorher", width: 8, get: (row) => row.before ? "ja" : "nein" },
                { header: "Nachher", width: 8, get: (row) => row.after ? "ja" : "nein" },
                { header: "Änderung", width: 11, get: (row) => row.changed ? "ja" : "nein" },
              ]),
              "",
              "Kein Write ausgeführt. Nach Prüfung mit --replace --yes erneut aufrufen.",
            ].join("\n"),
          );
          throw new Error("Vollständiger Matrix-Ersatz wurde nicht bestätigt (--yes fehlt).");
        }
        const { result } = application;
        output({
          run_id: application.runId,
          target: { type: "permission_matrix", role_id: roleId },
          current: result.before,
          diff: result.changes,
          risk: result.mode === "replace"
            ? "Vollersatz: Nicht gelieferte Permission-Keys wurden false."
            : "Patch: Nur gelieferte Permission-Keys wurden geändert.",
          ...result,
        }, opts.json, () => {
          if (!application.preview) {
            return `Permission-Matrix gepatcht: ${result.changed.length} Änderungen.`;
          }
          return [
            renderTable(application.preview.diff, [
              { header: "Permission", width: 36, get: (row) => row.permission_key },
              { header: "Vorher", width: 8, get: (row) => row.before ? "ja" : "nein" },
              { header: "Nachher", width: 8, get: (row) => row.after ? "ja" : "nein" },
              { header: "Änderung", width: 11, get: (row) => row.changed ? "ja" : "nein" },
            ]),
            "",
            `Permission-Matrix ersetzt: ${result.changed.length} Änderungen.`,
          ].join("\n");
        });
        return;
      }

      if (action === "assign") {
        const body = buildRoleAssignmentBody(clubId, opts);
        const current = await client.get<AssignmentRead[]>(
          "role",
          `/member-role-assignments/by-member/${opts.memberId}?club_id=${encodeURIComponent(clubId)}`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: {
            type: "role_assignment",
            member_id: opts.memberId,
            role_id: opts.roleId,
            scope: opts.scope,
            department_id: opts.departmentId ?? null,
          },
          current,
          diff: { assignment: { before: null, after: body } },
          risk: "Die neue Zuweisung kann dem Mitglied zusätzliche Zugriffe gewähren.",
        };
        emitMutationPreflight(evidence, opts.json);
        const assignment = await client.post<AssignmentRead>(
          "role",
          "/member-role-assignments/",
          body,
        );
        output({ ...evidence, result: assignment }, opts.json, () =>
          `Rolle ${assignment.role?.name ?? assignment.role_id} an Mitglied ${assignment.member_id} zugewiesen (${assignment.scope}).`,
        );
        return;
      }

      if (action === "unassign") {
        const assignmentId = arg1;
        if (!assignmentId) throw new Error("role unassign benötigt eine Assignment-ID.");
        const assignment = await client.get<AssignmentRead>(
          "role",
          `/member-role-assignments/by_id/${assignmentId}`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: { type: "role_assignment", assignment_id: assignmentId },
          current: assignment,
          diff: {
            is_active: { before: assignment.is_active ?? true, after: false },
            deleted_at: { before: assignment.deleted_at ?? null, after: "server_timestamp" },
          },
          risk: "Soft-Delete: Das Mitglied verliert die Rechte dieser Zuweisung.",
        };
        emitMutationPreflight(evidence, opts.json);
        await client.del("role", `/member-role-assignments/${assignmentId}`);
        output(
          {
            ...evidence,
            deleted: assignmentId,
            restore_command: `comvenio role assignment-restore ${assignmentId}`,
          },
          opts.json,
          () => `Rollenzuweisung entfernt: ${assignmentId} (${assignment.member_id} → ${assignment.role?.name ?? assignment.role_id})`,
        );
        return;
      }

      if (action === "assignment-restore") {
        const assignmentId = arg1;
        if (!assignmentId) throw new Error("role assignment-restore benötigt eine Assignment-ID.");
        const current = await client.get<AssignmentRead>(
          "role",
          `/member-role-assignments/by_id/${assignmentId}/deleted`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: { type: "role_assignment", assignment_id: assignmentId },
          current,
          diff: {
            is_active: { before: false, after: true },
            deleted_at: { before: current.deleted_at, after: null },
          },
          risk: "Restore: Das Mitglied erhält die Rechte dieser Zuweisung erneut.",
        };
        emitMutationPreflight(evidence, opts.json);
        const restored = await client.post<AssignmentRead>(
          "role",
          `/member-role-assignments/${assignmentId}/restore`,
          {},
        );
        output({
          ...evidence,
          result: restored,
        }, opts.json, () => `Rollenzuweisung wiederhergestellt: ${assignmentId}`);
        return;
      }

      if (action === "assignments") {
        const selectors = [opts.roleId, opts.memberId, opts.departmentId].filter(Boolean);
        if (selectors.length > 1) {
          throw new Error("role assignments erlaubt nur einen Filter: --role-id, --member-id oder --department-id.");
        }
        const path = opts.roleId
          ? `/member-role-assignments/by-role/${opts.roleId}`
          : opts.memberId
            ? `/member-role-assignments/by-member/${opts.memberId}?club_id=${encodeURIComponent(clubId)}`
            : opts.departmentId
              ? `/member-role-assignments/by-department/${opts.departmentId}`
              : `/member-role-assignments/by-club/${clubId}`;
        const rows = await client.get<AssignmentRead[]>("role", path);
        output(rows, opts.json, () => assignmentTable(rows));
        return;
      }

      if (action === "position-link") {
        if (!opts.positionId || !opts.roleId) {
          throw new Error("role position-link benötigt --position-id und --role-id.");
        }
        const body = prune({
          club_id: clubId,
          position_id: opts.positionId,
          role_id: opts.roleId,
          department_id: opts.departmentId,
        });
        const current = await client.get<PositionRoleRead[]>(
          "role",
          `/position-roles/by-position/${opts.positionId}`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: {
            type: "position_role",
            position_id: opts.positionId,
            role_id: opts.roleId,
            department_id: opts.departmentId ?? null,
          },
          current,
          diff: { position_role: { before: null, after: body } },
          risk: "Alle aktuellen und künftigen Positionsinhaber erhalten die Rollenrechte.",
        };
        emitMutationPreflight(evidence, opts.json);
        const row = await client.post<PositionRoleRead>("role", "/position-roles/", body);
        output({ ...evidence, result: row }, opts.json, () => `Positionsrolle verknüpft: ${row.id}`);
        return;
      }

      if (action === "position-unlink") {
        const assignmentId = arg1;
        if (!assignmentId) throw new Error("role position-unlink benötigt eine Assignment-ID.");
        const assignment = await client.get<PositionRoleRead>(
          "role",
          `/position-roles/${assignmentId}`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: { type: "position_role", assignment_id: assignmentId },
          current: assignment,
          diff: {
            is_active: { before: assignment.is_active ?? true, after: false },
            deleted_at: { before: assignment.deleted_at ?? null, after: "server_timestamp" },
          },
          risk: "Soft-Delete: Aus dieser Position werden bis zum Restore keine Rollenrechte abgeleitet.",
        };
        emitMutationPreflight(evidence, opts.json);
        await client.del("role", `/position-roles/${assignmentId}`);
        output(
          {
            ...evidence,
            deleted: assignmentId,
            restore_command: `comvenio role position-restore ${assignmentId}`,
          },
          opts.json,
          () => `Positionsrolle entfernt: ${assignmentId} (${assignment.position_id} → ${assignment.role?.name ?? assignment.role_id})`,
        );
        return;
      }

      if (action === "position-restore") {
        const assignmentId = arg1;
        if (!assignmentId) throw new Error("role position-restore benötigt eine Assignment-ID.");
        const current = await client.get<PositionRoleRead>(
          "role",
          `/position-roles/${assignmentId}/deleted`,
        );
        const evidence = {
          run_id: randomUUID(),
          target: { type: "position_role", assignment_id: assignmentId },
          current,
          diff: {
            is_active: { before: false, after: true },
            deleted_at: { before: current.deleted_at, after: null },
          },
          risk: "Restore: Aus dieser Position werden die Rollenrechte erneut abgeleitet.",
        };
        emitMutationPreflight(evidence, opts.json);
        const restored = await client.post<PositionRoleRead>(
          "role",
          `/position-roles/${assignmentId}/restore`,
          {},
        );
        output({
          ...evidence,
          result: restored,
        }, opts.json, () => `Positionsrolle wiederhergestellt: ${assignmentId}`);
        return;
      }

      if (action === "position-list") {
        if (!opts.positionId) throw new Error("role position-list benötigt --position-id.");
        const rows = await client.get<PositionRoleRead[]>(
          "role",
          `/position-roles/by-position/${opts.positionId}`,
        );
        output(rows, opts.json, () => rows.length
          ? renderTable(rows, [
              { header: "Assignment-ID", width: 36, get: (row) => row.id },
              { header: "Rolle", width: 24, get: (row) => row.role?.name ?? row.role_id },
              { header: "Abteilung", width: 36, get: (row) => row.department_id ?? "—" },
            ])
          : "Keine Rollen für diese Position.");
        return;
      }

      if (action === "effective") {
        if (!opts.memberId) throw new Error("role effective benötigt --member-id.");
        const query = new URLSearchParams({ club_id: clubId });
        if (opts.departmentId) query.set("department_id", opts.departmentId);
        const effective = await client.get<EffectivePermissionRead>(
          "role",
          `/permissions/effective/by-member/${opts.memberId}?${query.toString()}`,
        );
        output(effective, opts.json, () => effective.sources.length
          ? renderTable(effective.sources, [
              { header: "Permission", width: 34, get: (row) => row.permission_key },
              { header: "Ergebnis", width: 9, get: (row) => effective.permissions[row.permission_key] ? "erlaubt" : "verweigert" },
              { header: "Rollenwert", width: 10, get: (row) => row.allowed ? "erlaubt" : "verweigert" },
              { header: "Rolle", width: 24, get: (row) => row.role_name },
              { header: "Scope", width: 12, get: (row) => row.scope },
              { header: "Quelle", width: 10, get: (row) => row.assignment_type },
            ])
          : "Keine effektiven Rechte in diesem Scope.");
        return;
      }

      throw new Error(
        `Unbekannte role-Aktion "${action}". Verfügbar: list, show, create, update, delete, restore, permission-defs, permission set, permissions show|apply, assign, unassign, assignment-restore, assignments, position-link, position-unlink, position-restore, position-list, effective`,
      );
    });
}
