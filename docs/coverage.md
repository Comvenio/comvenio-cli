# CLI-Coverage

Version `1.0.0` fuer comvenio-cli `0.1.0`, verifiziert am 2026-07-13.

Diese Datei ist eine eigenstaendige, offline lesbare Workflow-Coverage. Sie wird aus `src/coverage/domains.json` erzeugt; die maschinenlesbare Kopie liegt unter `src/schema/coverage.json`.

> Workflow-level registry for the 22 top-level commands wired in src/index.ts. Public, anonymous, internal, service-to-service and AI-provider routes are not required to have a CLI command. Gaps name missing CLI workflows, not every technical backend route.

## Statusmodell

- `covered`: The intended club-admin workflow is available through the CLI. This does not imply one command per technical backend route.
- `core-partial`: Useful core operations exist, but at least one important club-admin workflow is still missing.
- `intentional-exclusion`: The top-level command is documented only as an explicit non-goal.

## Uebersicht

| Top-Level-Command | Status | Vorhandene Actions | Wichtige belegte Luecke |
|---|---|---|---|
| `login` | `covered` | login --token | Keine bekannte Kernluecke. |
| `logout` | `covered` | logout | Keine bekannte Kernluecke. |
| `whoami` | `covered` | whoami | Keine bekannte Kernluecke. |
| `club` | `core-partial` | info<br>design | The dispatcher has no general club profile update, department administration or settings read action. |
| `member` | `core-partial` | list<br>show<br>add<br>update<br>remove | The dispatcher does not expose family, membership-status, role-history or bulk-import workflows. |
| `team` | `core-partial` (Integration ausstehend) | list<br>member list<br>member add<br>member remove | The dispatcher has no team create, show, update or delete action. |
| `event` | `covered` | list<br>show<br>create<br>update<br>publish<br>delete<br>template list|create|clone|instantiate<br>series list|show|create|materialize|promote-recurring|promote-yearly|next<br>area list|add|show|update|delete|bulk|copy<br>assignment list|add|remove|clear<br>lead list|add|update|delete<br>area-note list|add|update|delete<br>program list|add|update|delete|reorder<br>contact list|add|update|delete<br>resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch<br>attachment list|show|add|update|delete<br>tag category and assignment workflows<br>sponsor and sponsor-program workflows<br>invitation and club-invitation workflows<br>registration list|add|stats|show|update|adjust|delete|aggregate<br>budget show|set|delete<br>design theme and asset workflows<br>copy set|reset<br>dj settings and request workflows<br>external-sync workflows<br>instance previous|next|compare|clone-next<br>child list|create|invitation-summary<br>menu list|assign|unassign | Keine bekannte Kernluecke. |
| `booking` | `core-partial` (Integration ausstehend) | list<br>show<br>approve<br>reject | The dispatcher has no create, update, cancel or delete workflow for reservations. |
| `object` | `core-partial` (Integration ausstehend) | list | The dispatcher has no object show, create, update, availability or delete workflow. |
| `task` | `core-partial` | list<br>show<br>show --subtasks<br>show --chain<br>create<br>assign<br>done<br>context list<br>context create | The dispatcher has no general update, reopen, cancel, delete, assignment-list or assignment-remove action. |
| `recipe` | `covered` | create<br>from-template<br>list<br>show<br>update<br>delete | Keine bekannte Kernluecke. |
| `template` | `covered` | dish<br>ingredient | Keine bekannte Kernluecke. |
| `menu` | `covered` | create<br>list<br>show<br>add-item<br>update-item<br>delete-item<br>delete<br>style<br>apply<br>export | Keine bekannte Kernluecke. |
| `meeting` | `core-partial` (Integration ausstehend) | list<br>series<br>show<br>entries<br>resolutions | The current dispatcher is read-only and does not expose meeting/protocol lifecycle, agenda, participants, voting or resolution mutations. |
| `homepage` | `covered` | preview<br>apply<br>show | Keine bekannte Kernluecke. |
| `schema` | `core-partial` | list domains<br>show domain schema | Machine-readable domain schemas are not yet available for every top-level command. |
| `verify` | `covered` | url<br>event<br>menu<br>homepage<br>news<br>certificate | Keine bekannte Kernluecke. |
| `data` | `core-partial` | list<br>show<br>update<br>url<br>download<br>upload<br>delete<br>restore<br>move<br>visibility<br>stats<br>empty-trash<br>children<br>search<br>breadcrumb<br>folder-create<br>folder-rename<br>folder-move<br>folder-protect<br>folder-delete<br>folder-restore<br>papers<br>paper-show<br>paper-add<br>paper-update<br>paper-delete<br>export members|bookings | Area-share/media-map workflows and publication/newsletter-specific administration are not exposed by the data dispatcher. |
| `news` | `covered` | list<br>show<br>create<br>update<br>delete<br>apply<br>preview<br>publish<br>video slideshow|result|teaser | Keine bekannte Kernluecke. |
| `plan` | `covered` | list<br>show<br>create<br>update<br>delete<br>zone list|create|update|delete|link|unlink<br>table create|duplicate|update|delete<br>marker create|update|delete<br>guest list|add|update|delete<br>detail<br>export<br>illustrate<br>compose | Keine bekannte Kernluecke. |
| `tournament` | `core-partial` | series-list<br>series-create<br>execution-create<br>execution-link<br>list<br>show<br>status<br>participants<br>mannschaft<br>participant<br>participant-withdraw<br>participant-reinstate<br>participant-remove<br>start<br>matches<br>matches-clear<br>reset<br>redraw<br>standings<br>preview<br>draw<br>draw-confirm<br>schedule-generate<br>match-schedule<br>match-delete<br>match-result | The dispatcher has no generic tournament create/update/delete command; creation is available through a series execution. |
| `sponsor` | `core-partial` | list<br>show<br>add<br>update<br>logo<br>product-list<br>product-add<br>product-update<br>product-delete<br>contract-list<br>contract-add<br>assignment-list<br>assign<br>assignment-update<br>cancel<br>doc-list<br>doc-upload<br>responsible-list<br>responsible-add<br>responsible-update<br>responsible-remove | The dispatcher has no advertiser delete action and no update/delete action for an existing contract version. |

## Verbindliche Nutzungsregeln

1. Nutze ausschliesslich dokumentierte CLI-Actions; direkte Backend-Aufrufe sind kein Ersatz fuer eine CLI-Luecke.
2. Lies fuer Payloads zuerst die verlinkte Domaenen-Doku und danach `comvenio <domain> --help`.
3. Nutze bei Agenten immer `--json`; Fehler erscheinen auf stderr und haben einen Exit-Code ungleich null.
4. `core-partial` bedeutet: den vorhandenen Teil nutzen, die dokumentierte Luecke aber nicht durch einen direkten API-Call umgehen.

## login

- Status: `covered`
- Actions: `login --token`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - No password login and no token decoding; the opaque cvn_ token is verified server-side before it is stored.
- Gepruefte Quellen: `src/index.ts`, `src/auth.ts`
- Weiterfuehrende Doku: `docs/auth-club.md`

## logout

- Status: `covered`
- Actions: `logout`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Logout removes local CLI state; it does not revoke a device token on the server.
- Gepruefte Quellen: `src/index.ts`, `src/auth.ts`
- Weiterfuehrende Doku: `docs/auth-club.md`

## whoami

- Status: `covered`
- Actions: `whoami`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Transient user-service failures may use cached identity fields; authentication and authorization failures are never hidden.
- Gepruefte Quellen: `src/commands/whoami.ts`
- Weiterfuehrende Doku: `docs/auth-club.md`

## club

- Status: `core-partial`
- Actions: `info`, `design`
- Wichtige Luecken:
  - The dispatcher has no general club profile update, department administration or settings read action.
- Bewusste Ausschluesse:
  - Homepage content is managed by homepage; members and teams have separate commands.
- Gepruefte Quellen: `src/commands/club.ts`
- Weiterfuehrende Doku: `docs/auth-club.md`, `docs/homepage.md`

## member

- Status: `core-partial`
- Actions: `list`, `show`, `add`, `update`, `remove`
- Wichtige Luecken:
  - The dispatcher does not expose family, membership-status, role-history or bulk-import workflows.
- Bewusste Ausschluesse:
  - Team membership is managed through team member actions.
- Gepruefte Quellen: `src/commands/member.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## team

- Status: `core-partial` (Integration ausstehend)
- Actions: `list`, `member list`, `member add`, `member remove`
- Wichtige Luecken:
  - The dispatcher has no team create, show, update or delete action.
- Bewusste Ausschluesse:
  - Keine.
- Gepruefte Quellen: `src/commands/team.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## event

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `publish`, `delete`, `template list|create|clone|instantiate`, `series list|show|create|materialize|promote-recurring|promote-yearly|next`, `area list|add|show|update|delete|bulk|copy`, `assignment list|add|remove|clear`, `lead list|add|update|delete`, `area-note list|add|update|delete`, `program list|add|update|delete|reorder`, `contact list|add|update|delete`, `resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch`, `attachment list|show|add|update|delete`, `tag category and assignment workflows`, `sponsor and sponsor-program workflows`, `invitation and club-invitation workflows`, `registration list|add|stats|show|update|adjust|delete|aggregate`, `budget show|set|delete`, `design theme and asset workflows`, `copy set|reset`, `dj settings and request workflows`, `external-sync workflows`, `instance previous|next|compare|clone-next`, `child list|create|invitation-summary`, `menu list|assign|unassign`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Anonymous/public self-service routes, backend-internal routes and provider-specific technical administration are outside the club-admin CLI.
- Gepruefte Quellen: `src/commands/event.ts`, `src/commands/event-operations.ts`
- Weiterfuehrende Doku: `docs/veranstaltungen.md`

## booking

- Status: `core-partial` (Integration ausstehend)
- Actions: `list`, `show`, `approve`, `reject`
- Wichtige Luecken:
  - The dispatcher has no create, update, cancel or delete workflow for reservations.
- Bewusste Ausschluesse:
  - Keine.
- Gepruefte Quellen: `src/commands/booking.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## object

- Status: `core-partial` (Integration ausstehend)
- Actions: `list`
- Wichtige Luecken:
  - The dispatcher has no object show, create, update, availability or delete workflow.
- Bewusste Ausschluesse:
  - Keine.
- Gepruefte Quellen: `src/commands/object.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## task

- Status: `core-partial`
- Actions: `list`, `show`, `show --subtasks`, `show --chain`, `create`, `assign`, `done`, `context list`, `context create`
- Wichtige Luecken:
  - The dispatcher has no general update, reopen, cancel, delete, assignment-list or assignment-remove action.
- Bewusste Ausschluesse:
  - Keine.
- Gepruefte Quellen: `src/commands/task.ts`
- Weiterfuehrende Doku: `docs/aufgaben.md`

## recipe

- Status: `covered`
- Actions: `create`, `from-template`, `list`, `show`, `update`, `delete`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Ingredient, allergen and colorant administration is not exposed as recipe actions; template-backed recipe creation is the supported agent workflow.
- Gepruefte Quellen: `src/commands/recipe.ts`
- Weiterfuehrende Doku: `docs/speisekarten.md`

## template

- Status: `covered`
- Actions: `dish`, `ingredient`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Global templates are read-only; mutation and seeding are platform administration concerns.
- Gepruefte Quellen: `src/commands/template.ts`
- Weiterfuehrende Doku: `docs/speisekarten.md`

## menu

- Status: `covered`
- Actions: `create`, `list`, `show`, `add-item`, `update-item`, `delete-item`, `delete`, `style`, `apply`, `export`
- Entfernte/gesperrte Actions: `generate`, `design`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - generate and design deliberately fail: the operating agent composes content and CSS/design_config itself; the CLI never calls a backend LLM.
- Gepruefte Quellen: `src/commands/menu.ts`
- Weiterfuehrende Doku: `docs/speisekarten.md`

## meeting

- Status: `core-partial` (Integration ausstehend)
- Actions: `list`, `series`, `show`, `entries`, `resolutions`
- Wichtige Luecken:
  - The current dispatcher is read-only and does not expose meeting/protocol lifecycle, agenda, participants, voting or resolution mutations.
- Bewusste Ausschluesse:
  - Public join/token flows, internal routes and AI-assistant internals are not club-admin CLI workflows.
- Gepruefte Quellen: `src/commands/meeting.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## homepage

- Status: `covered`
- Actions: `preview`, `apply`, `show`
- Entfernte/gesperrte Actions: `generate`, `design`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - generate and design deliberately fail; the agent composes a schema-valid homepage and uses club design for theme settings.
- Gepruefte Quellen: `src/commands/homepage.ts`, `src/commands/club.ts`
- Weiterfuehrende Doku: `docs/homepage.md`

## schema

- Status: `core-partial`
- Actions: `list domains`, `show domain schema`
- Wichtige Luecken:
  - Machine-readable domain schemas are not yet available for every top-level command.
- Bewusste Ausschluesse:
  - coverage.json is a separate workflow-coverage registry and is readable offline.
- Gepruefte Quellen: `src/commands/schema.ts`, `src/schema/coverage.json`
- Weiterfuehrende Doku: `docs/coverage.md`, `docs/cli-reference.md`

## verify

- Status: `covered`
- Actions: `url`, `event`, `menu`, `homepage`, `news`, `certificate`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Only visual or document surfaces with a deterministic verifier are included; verify is not a generic API health check.
- Gepruefte Quellen: `src/commands/verify.ts`, `src/verify/homepage.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`, `docs/homepage.md`

## data

- Status: `core-partial`
- Actions: `list`, `show`, `update`, `url`, `download`, `upload`, `delete`, `restore`, `move`, `visibility`, `stats`, `empty-trash`, `children`, `search`, `breadcrumb`, `folder-create`, `folder-rename`, `folder-move`, `folder-protect`, `folder-delete`, `folder-restore`, `papers`, `paper-show`, `paper-add`, `paper-update`, `paper-delete`, `export members|bookings`
- Wichtige Luecken:
  - Area-share/media-map workflows and publication/newsletter-specific administration are not exposed by the data dispatcher.
- Bewusste Ausschluesse:
  - Content analysis is performed by the operating agent after download; there is no analyze endpoint in this CLI.
- Gepruefte Quellen: `src/commands/data.ts`, `src/util/upload.ts`
- Weiterfuehrende Doku: `docs/dateien.md`

## news

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `apply`, `preview`, `publish`, `video slideshow|result|teaser`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - The CLI does not call a writing LLM; the operating agent composes rich HTML. Anonymous public reads are a frontend concern.
- Gepruefte Quellen: `src/commands/news.ts`
- Weiterfuehrende Doku: `docs/vereinsnews.md`, `docs/dateien.md`

## plan

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `zone list|create|update|delete|link|unlink`, `table create|duplicate|update|delete`, `marker create|update|delete`, `guest list|add|update|delete`, `detail`, `export`, `illustrate`, `compose`
- Wichtige Luecken:
  - Keine bekannte Kernluecke im vorgesehenen CLI-Scope.
- Bewusste Ausschluesse:
  - Image generation itself is external to the CLI; illustrate prepares the deterministic kit and compose overlays exact labels.
- Gepruefte Quellen: `src/commands/plan.ts`
- Weiterfuehrende Doku: `docs/cli-reference.md`

## tournament

- Status: `core-partial`
- Actions: `series-list`, `series-create`, `execution-create`, `execution-link`, `list`, `show`, `status`, `participants`, `mannschaft`, `participant`, `participant-withdraw`, `participant-reinstate`, `participant-remove`, `start`, `matches`, `matches-clear`, `reset`, `redraw`, `standings`, `preview`, `draw`, `draw-confirm`, `schedule-generate`, `match-schedule`, `match-delete`, `match-result`
- Wichtige Luecken:
  - The dispatcher has no generic tournament create/update/delete command; creation is available through a series execution.
- Bewusste Ausschluesse:
  - Public registration and public bracket reads are frontend/self-service concerns.
- Gepruefte Quellen: `src/commands/tournament.ts`
- Weiterfuehrende Doku: `docs/turniere.md`

## sponsor

- Status: `core-partial`
- Actions: `list`, `show`, `add`, `update`, `logo`, `product-list`, `product-add`, `product-update`, `product-delete`, `contract-list`, `contract-add`, `assignment-list`, `assign`, `assignment-update`, `cancel`, `doc-list`, `doc-upload`, `responsible-list`, `responsible-add`, `responsible-update`, `responsible-remove`
- Wichtige Luecken:
  - The dispatcher has no advertiser delete action and no update/delete action for an existing contract version.
- Bewusste Ausschluesse:
  - Global ad-marketplace and platform billing administration are outside local club sponsorship.
- Gepruefte Quellen: `src/commands/sponsor.ts`, `src/util/upload.ts`
- Weiterfuehrende Doku: `docs/sponsoring.md`, `docs/dateien.md`
