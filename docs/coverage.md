# CLI-Coverage

Version `1.0.0` für comvenio-cli `0.1.0`, verifiziert am 2026-07-13.

Diese Datei ist eine eigenständige, offline lesbare Workflow-Coverage. Sie wird aus `src/coverage/domains.json` erzeugt; die maschinenlesbare Kopie liegt unter `src/schema/coverage.json`.

> Workflow-Registry für die 25 in src/index.ts verdrahteten Top-Level-Commands. Öffentliche, anonyme, interne, Service-to-Service- und AI-Provider-Routen benötigen keine eigene CLI-Action. Lücken benennen fehlende CLI-Workflows, nicht jede technische Backend-Route.

## Statusmodell

- `covered`: Der vorgesehene Club-Admin-Workflow ist über das CLI verfügbar. Das bedeutet nicht, dass jede technische Backend-Route eine eigene Action braucht.
- `core-partial`: Ein nutzbarer Kern ist vorhanden, aber mindestens ein wichtiger Club-Admin-Workflow fehlt noch.
- `intentional-exclusion`: Der Top-Level-Command ist ausschließlich als bewusstes Nicht-Ziel dokumentiert.

## Übersicht

| Top-Level-Command | Status | Vorhandene Actions | Wichtige belegte Lücke |
|---|---|---|---|
| `login` | `covered` | login --token | Keine bekannte Kernlücke. |
| `logout` | `covered` | logout | Keine bekannte Kernlücke. |
| `whoami` | `covered` | whoami | Keine bekannte Kernlücke. |
| `club` | `covered` | info<br>update<br>settings<br>settings-update<br>design<br>department-list<br>department-show<br>department-add<br>department-update<br>department-delete | Keine bekannte Kernlücke. |
| `member` | `covered` | list<br>show<br>add<br>update<br>remove<br>import<br>family-list<br>family-show<br>family-add<br>family-update<br>family-delete<br>status-list<br>status-show<br>status-add<br>status-update<br>status-delete<br>period-list<br>period-show<br>period-add<br>period-update<br>period-delete | Keine bekannte Kernlücke. |
| `team` | `covered` | list<br>show<br>create<br>update<br>delete<br>member list|add|update|remove<br>resource list|add|update|remove | Keine bekannte Kernlücke. |
| `event` | `covered` | list<br>show<br>create<br>update<br>publish<br>delete<br>template list|create|clone|instantiate<br>series list|show|create|materialize|promote-recurring|promote-yearly|next<br>area list|add|show|update|delete|bulk|copy<br>assignment list|add|remove|clear<br>lead list|add|update|delete<br>area-note list|add|update|delete<br>program list|add|update|delete|reorder<br>contact list|add|update|delete<br>resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch<br>attachment list|show|add|update|delete<br>tag category and assignment workflows<br>sponsor and sponsor-program workflows<br>invitation and club-invitation workflows<br>registration list|add|stats|show|update|adjust|delete|aggregate<br>budget show|set|delete<br>design theme and asset workflows<br>copy set|reset<br>dj settings and request workflows<br>external-sync workflows<br>instance previous|next|compare|clone-next<br>child list|create|invitation-summary<br>menu list|assign|unassign | Keine bekannte Kernlücke. |
| `booking` | `covered` | list<br>show<br>create<br>update<br>approve<br>reject<br>cancel<br>delete<br>bulk<br>participant list|show|add|add-groups|update|remove<br>link list|club|add|remove<br>stats object|guests | Keine bekannte Kernlücke. |
| `object` | `covered` | list<br>show<br>create<br>update<br>delete<br>building list|show|create|update|delete<br>room list|show|create|update|delete<br>booking-rule list|show|create|bulk|update|delete<br>task-rule list|show|create|update|delete | Keine bekannte Kernlücke. |
| `task` | `covered` | list<br>show<br>show --subtasks<br>show --chain<br>create<br>bulk<br>update<br>assign<br>done<br>delete<br>context list|show|create|update|delete<br>assignment list|show|update|delete<br>note list|add|update|delete<br>checklist list|add|update|toggle|delete|reorder | Keine bekannte Kernlücke. |
| `recipe` | `covered` | create<br>from-template<br>list<br>show<br>update<br>delete | Keine bekannte Kernlücke. |
| `ingredient` | `covered` | list<br>show<br>create<br>update<br>delete | Keine bekannte Kernlücke. |
| `ingredient-category` | `core-partial` | list<br>roots<br>tree<br>by-ingredient<br>show<br>create<br>update<br>delete<br>assign<br>unassign<br>init | Der Backend-Create-Vertrag greift aktuell auf club_id zu, obwohl IngredientCategoryCreate das Feld nicht deklariert; das CLI sendet club_id korrekt mit, aber create benötigt eine Backend-Korrektur. |
| `shopping` | `core-partial` | list<br>active<br>completed<br>by-context<br>by-context-type<br>show<br>create<br>update<br>delete<br>item-add<br>item-update<br>item-delete<br>purchased<br>generate-from-recipe<br>generate-from-menu | shopping.py enthält vor GET /lists/{id} einen nackten @router.get-Decorator; dieser Backend-Codefehler gefährdet Router-Import und Endpoint-Verfügbarkeit, obwohl die CLI-Actions implementiert sind. |
| `template` | `covered` | dish<br>ingredient | Keine bekannte Kernlücke. |
| `menu` | `covered` | create<br>list<br>show<br>add-item<br>update-item<br>delete-item<br>delete<br>style<br>apply<br>export | Keine bekannte Kernlücke. |
| `meeting` | `covered` | series list|show|create|update|delete<br>protocol list|show|create|update|delete|advance|revert|updates|validation|publish<br>agenda list|show|create|update|delete|reorder|start|complete|skip|approve<br>note list|list-protocol|create|update|delete<br>participant list|add|update|remove|validate|unvalidate<br>decision create|agenda|update|cancel|option-add|options-add|promote<br>voting open|close|results|eligible|tally<br>vote cast|cast-bulk|proxy|proxy-bulk|option-retract|retract<br>resolution list|list-protocol|show|history|create|update|approve|decline|delete<br>entry list|show|show-agenda|create|update|delete<br>attachment list|add|remove | Keine bekannte Kernlücke. |
| `homepage` | `covered` | preview<br>apply<br>show | Keine bekannte Kernlücke. |
| `schema` | `core-partial` | list domains<br>show domain schema | Detaillierte Payload- und Enum-Schemas sind noch nicht für jeden Top-Level-Command verfügbar; fehlende Domains erhalten nur einen Workflow-Coverage-Fallback. |
| `verify` | `covered` | url<br>event<br>menu<br>homepage<br>news<br>certificate | Keine bekannte Kernlücke. |
| `data` | `covered` | list<br>show<br>update<br>url<br>download<br>upload<br>delete<br>restore<br>move<br>visibility<br>stats<br>empty-trash<br>area-media<br>area-shares<br>area-share-add<br>area-share-remove<br>children<br>search<br>breadcrumb<br>folder-create<br>folder-rename<br>folder-move<br>folder-protect<br>folder-delete<br>folder-restore<br>folder-rights<br>folder-right-add<br>folder-right-bulk<br>folder-right-delete<br>papers<br>paper-show<br>paper-add<br>paper-update<br>paper-delete<br>export members|bookings | Keine bekannte Kernlücke. |
| `news` | `covered` | list<br>show<br>create<br>update<br>delete<br>apply<br>preview<br>publish<br>video slideshow|result|teaser | Keine bekannte Kernlücke. |
| `plan` | `covered` | list<br>show<br>create<br>update<br>delete<br>zone list|create|update|delete|link|unlink<br>table create|duplicate|update|delete<br>marker create|update|delete<br>guest list|add|update|delete<br>detail<br>export<br>illustrate<br>compose | Keine bekannte Kernlücke. |
| `tournament` | `covered` | series-list<br>series-show<br>series-create<br>series-update<br>series-delete<br>execution-create<br>execution-link<br>list<br>show<br>update<br>delete<br>status<br>participants<br>mannschaft<br>participant<br>participant-withdraw<br>participant-reinstate<br>participant-remove<br>start<br>matches<br>matches-clear<br>reset<br>redraw<br>standings<br>preview<br>draw<br>draw-confirm<br>schedule-generate<br>match-schedule<br>match-delete<br>match-result<br>deadline | Keine bekannte Kernlücke. |
| `sponsor` | `core-partial` | list<br>show<br>add<br>update<br>logo<br>product-list<br>product-add<br>product-update<br>product-delete<br>contract-list<br>contract-add<br>assignment-list<br>assign<br>assignment-update<br>cancel<br>doc-list<br>doc-upload<br>responsible-list<br>responsible-add<br>responsible-update<br>responsible-remove | Der marketing-service stellt für Advertiser kein DELETE und für bestehende Vertragsversionen nur GET/POST, aber kein PATCH/DELETE bereit; daher kann das CLI diese Mutationen nicht abbilden. |

## Verbindliche Nutzungsregeln

1. Nutze ausschließlich dokumentierte CLI-Actions; direkte Backend-Aufrufe sind kein Ersatz für eine CLI-Lücke.
2. Lies für Payloads zuerst die verlinkte Domänen-Doku und danach `comvenio <domain> --help`.
3. Nutze bei Agenten immer `--json`; Fehler erscheinen auf stderr und haben einen Exit-Code ungleich null.
4. `core-partial` bedeutet: den vorhandenen Teil nutzen, die dokumentierte Lücke aber nicht durch einen direkten API-Call umgehen.

## login

- Status: `covered`
- Actions: `login --token`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Kein Passwort-Login und kein Token-Decoding; das opake cvn_-Token wird vor dem Speichern serverseitig geprüft.
- Geprüfte Quellen: `src/index.ts`, `src/auth.ts`
- Weiterführende Doku: `docs/auth-club.md`

## logout

- Status: `covered`
- Actions: `logout`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Logout entfernt den lokalen CLI-State; das Device-Token wird dadurch nicht serverseitig widerrufen.
- Geprüfte Quellen: `src/index.ts`, `src/auth.ts`
- Weiterführende Doku: `docs/auth-club.md`

## whoami

- Status: `covered`
- Actions: `whoami`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Bei vorübergehenden Ausfällen dürfen gecachte Identitätsfelder erscheinen; Authentifizierungs- und Autorisierungsfehler werden nie verborgen.
- Geprüfte Quellen: `src/commands/whoami.ts`
- Weiterführende Doku: `docs/auth-club.md`

## club

- Status: `covered`
- Actions: `info`, `update`, `settings`, `settings-update`, `design`, `department-list`, `department-show`, `department-add`, `department-update`, `department-delete`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Homepage-Inhalte verwaltet homepage; Mitglieder und Teams haben eigene Commands.
- Geprüfte Quellen: `src/commands/club.ts`
- Weiterführende Doku: `docs/auth-club.md`, `docs/homepage.md`

## member

- Status: `covered`
- Actions: `list`, `show`, `add`, `update`, `remove`, `import`, `family-list`, `family-show`, `family-add`, `family-update`, `family-delete`, `status-list`, `status-show`, `status-add`, `status-update`, `status-delete`, `period-list`, `period-show`, `period-add`, `period-update`, `period-delete`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Team-Mitgliedschaften werden über team member verwaltet.
- Geprüfte Quellen: `src/commands/member.ts`
- Weiterführende Doku: `docs/mitglieder-teams.md`, `docs/cli-reference.md`

## team

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `member list|add|update|remove`, `resource list|add|update|remove`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Keine.
- Geprüfte Quellen: `src/commands/team.ts`
- Weiterführende Doku: `docs/mitglieder-teams.md`

## event

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `publish`, `delete`, `template list|create|clone|instantiate`, `series list|show|create|materialize|promote-recurring|promote-yearly|next`, `area list|add|show|update|delete|bulk|copy`, `assignment list|add|remove|clear`, `lead list|add|update|delete`, `area-note list|add|update|delete`, `program list|add|update|delete|reorder`, `contact list|add|update|delete`, `resource list|add|set|remove|link-show|link-update|link-delete|usage|usage-batch`, `attachment list|show|add|update|delete`, `tag category and assignment workflows`, `sponsor and sponsor-program workflows`, `invitation and club-invitation workflows`, `registration list|add|stats|show|update|adjust|delete|aggregate`, `budget show|set|delete`, `design theme and asset workflows`, `copy set|reset`, `dj settings and request workflows`, `external-sync workflows`, `instance previous|next|compare|clone-next`, `child list|create|invitation-summary`, `menu list|assign|unassign`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Anonyme/öffentliche Self-Service-Routen, Backend-Interna und providerspezifische technische Administration liegen außerhalb des Club-Admin-CLI.
- Geprüfte Quellen: `src/commands/event.ts`, `src/commands/event-operations.ts`
- Weiterführende Doku: `docs/veranstaltungen.md`

## booking

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `approve`, `reject`, `cancel`, `delete`, `bulk`, `participant list|show|add|add-groups|update|remove`, `link list|club|add|remove`, `stats object|guests`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Anonyme/öffentliche Buchungsflows, Provider-Importe und technische Export-Routen liegen außerhalb des Club-Admin-Dispatchers.
- Geprüfte Quellen: `src/commands/booking.ts`
- Weiterführende Doku: `docs/buchungen-objekte.md`

## object

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `building list|show|create|update|delete`, `room list|show|create|update|delete`, `booking-rule list|show|create|bulk|update|delete`, `task-rule list|show|create|update|delete`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Objekt-Tags sowie technische Export- und Provider-Batch-Routen liegen bewusst außerhalb des Club-Admin-Dispatchers.
- Geprüfte Quellen: `src/commands/object.ts`
- Weiterführende Doku: `docs/buchungen-objekte.md`

## task

- Status: `covered`
- Actions: `list`, `show`, `show --subtasks`, `show --chain`, `create`, `bulk`, `update`, `assign`, `done`, `delete`, `context list|show|create|update|delete`, `assignment list|show|update|delete`, `note list|add|update|delete`, `checklist list|add|update|toggle|delete|reorder`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Keine.
- Geprüfte Quellen: `src/commands/task.ts`
- Weiterführende Doku: `docs/aufgaben.md`

## recipe

- Status: `covered`
- Actions: `create`, `from-template`, `list`, `show`, `update`, `delete`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Zutaten-, Allergen- und Farbstoff-Administration sind keine recipe-Actions; vorlagengestützte Rezepterstellung ist der vorgesehene Agenten-Workflow.
- Geprüfte Quellen: `src/commands/recipe.ts`
- Weiterführende Doku: `docs/speisekarten.md`

## ingredient

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Globale Zutatenvorlagen bleiben im read-only template-Command; interne, öffentliche und globale Sync-Routen sind keine Club-Admin-Actions.
- Geprüfte Quellen: `src/commands/ingredient.ts`, `src/schema/ingredient.json`
- Weiterführende Doku: `docs/speisekarten.md`

## ingredient-category

- Status: `core-partial`
- Actions: `list`, `roots`, `tree`, `by-ingredient`, `show`, `create`, `update`, `delete`, `assign`, `unassign`, `init`
- Wichtige Lücken:
  - Der Backend-Create-Vertrag greift aktuell auf club_id zu, obwohl IngredientCategoryCreate das Feld nicht deklariert; das CLI sendet club_id korrekt mit, aber create benötigt eine Backend-Korrektur.
- Bewusste Ausschlüsse:
  - Interne Service-to-Service-Nutzung ist keine Club-Admin-Action.
- Geprüfte Quellen: `src/commands/ingredient-category.ts`, `src/schema/ingredient-category.json`
- Weiterführende Doku: `docs/speisekarten.md`

## shopping

- Status: `core-partial`
- Actions: `list`, `active`, `completed`, `by-context`, `by-context-type`, `show`, `create`, `update`, `delete`, `item-add`, `item-update`, `item-delete`, `purchased`, `generate-from-recipe`, `generate-from-menu`
- Wichtige Lücken:
  - shopping.py enthält vor GET /lists/{id} einen nackten @router.get-Decorator; dieser Backend-Codefehler gefährdet Router-Import und Endpoint-Verfügbarkeit, obwohl die CLI-Actions implementiert sind.
- Bewusste Ausschlüsse:
  - Interne, öffentliche und globale Sync-Routen sind keine Club-Admin-Actions.
- Geprüfte Quellen: `src/commands/shopping.ts`, `src/schema/shopping.json`
- Weiterführende Doku: `docs/speisekarten.md`

## template

- Status: `covered`
- Actions: `dish`, `ingredient`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Globale Vorlagen sind nur lesbar; Mutation und Seeding sind Plattform-Administration.
- Geprüfte Quellen: `src/commands/template.ts`
- Weiterführende Doku: `docs/speisekarten.md`

## menu

- Status: `covered`
- Actions: `create`, `list`, `show`, `add-item`, `update-item`, `delete-item`, `delete`, `style`, `apply`, `export`
- Entfernte/gesperrte Actions: `generate`, `design`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - generate und design brechen bewusst ab: Der bedienende Agent komponiert Inhalt und CSS/design_config selbst; das CLI ruft kein Backend-LLM auf.
- Geprüfte Quellen: `src/commands/menu.ts`
- Weiterführende Doku: `docs/speisekarten.md`

## meeting

- Status: `covered`
- Actions: `series list|show|create|update|delete`, `protocol list|show|create|update|delete|advance|revert|updates|validation|publish`, `agenda list|show|create|update|delete|reorder|start|complete|skip|approve`, `note list|list-protocol|create|update|delete`, `participant list|add|update|remove|validate|unvalidate`, `decision create|agenda|update|cancel|option-add|options-add|promote`, `voting open|close|results|eligible|tally`, `vote cast|cast-bulk|proxy|proxy-bulk|option-retract|retract`, `resolution list|list-protocol|show|history|create|update|approve|decline|delete`, `entry list|show|show-agenda|create|update|delete`, `attachment list|add|remove`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Öffentliche Join-/Token-Flows, interne Routen und AI-Assistant-Interna sind keine Club-Admin-CLI-Workflows.
- Geprüfte Quellen: `src/commands/meeting.ts`
- Weiterführende Doku: `docs/meetings.md`

## homepage

- Status: `covered`
- Actions: `preview`, `apply`, `show`
- Entfernte/gesperrte Actions: `generate`, `design`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - generate und design brechen bewusst ab; der Agent komponiert eine schema-gültige Homepage und nutzt club design für Theme-Einstellungen.
- Geprüfte Quellen: `src/commands/homepage.ts`, `src/commands/club.ts`
- Weiterführende Doku: `docs/homepage.md`

## schema

- Status: `core-partial`
- Actions: `list domains`, `show domain schema`
- Wichtige Lücken:
  - Detaillierte Payload- und Enum-Schemas sind noch nicht für jeden Top-Level-Command verfügbar; fehlende Domains erhalten nur einen Workflow-Coverage-Fallback.
- Bewusste Ausschlüsse:
  - coverage.json ist eine getrennte Workflow-Coverage-Registry und offline lesbar.
- Geprüfte Quellen: `src/commands/schema.ts`, `src/schema/coverage.json`
- Weiterführende Doku: `docs/coverage.md`, `docs/cli-reference.md`

## verify

- Status: `covered`
- Actions: `url`, `event`, `menu`, `homepage`, `news`, `certificate`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Enthalten sind nur visuelle oder Dokument-Oberflächen mit deterministischem Verifier; verify ist kein allgemeiner API-Healthcheck.
- Geprüfte Quellen: `src/commands/verify.ts`, `src/verify/homepage.ts`
- Weiterführende Doku: `docs/cli-reference.md`, `docs/homepage.md`

## data

- Status: `covered`
- Actions: `list`, `show`, `update`, `url`, `download`, `upload`, `delete`, `restore`, `move`, `visibility`, `stats`, `empty-trash`, `area-media`, `area-shares`, `area-share-add`, `area-share-remove`, `children`, `search`, `breadcrumb`, `folder-create`, `folder-rename`, `folder-move`, `folder-protect`, `folder-delete`, `folder-restore`, `folder-rights`, `folder-right-add`, `folder-right-bulk`, `folder-right-delete`, `papers`, `paper-show`, `paper-add`, `paper-update`, `paper-delete`, `export members|bookings`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Die Inhaltsanalyse übernimmt der bedienende Agent nach dem Download; dieses CLI besitzt keinen analyze-Endpoint.
  - Publikations- und Newsletter-Fachworkflows bleiben in ihren eigenen Domänen; DataShare verwaltet Dateien und Kontexte.
- Geprüfte Quellen: `src/commands/data.ts`, `src/util/upload.ts`
- Weiterführende Doku: `docs/dateien.md`

## news

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `apply`, `preview`, `publish`, `video slideshow|result|teaser`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Das CLI ruft kein schreibendes LLM auf; der bedienende Agent komponiert Rich-HTML. Anonyme öffentliche Reads sind Aufgabe des Frontends.
- Geprüfte Quellen: `src/commands/news.ts`
- Weiterführende Doku: `docs/vereinsnews.md`, `docs/dateien.md`

## plan

- Status: `covered`
- Actions: `list`, `show`, `create`, `update`, `delete`, `zone list|create|update|delete|link|unlink`, `table create|duplicate|update|delete`, `marker create|update|delete`, `guest list|add|update|delete`, `detail`, `export`, `illustrate`, `compose`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Die Bildgenerierung selbst liegt außerhalb des CLI; illustrate bereitet das deterministische Kit vor und compose setzt exakte Beschriftungen darüber.
- Geprüfte Quellen: `src/commands/plan.ts`
- Weiterführende Doku: `docs/cli-reference.md`

## tournament

- Status: `covered`
- Actions: `series-list`, `series-show`, `series-create`, `series-update`, `series-delete`, `execution-create`, `execution-link`, `list`, `show`, `update`, `delete`, `status`, `participants`, `mannschaft`, `participant`, `participant-withdraw`, `participant-reinstate`, `participant-remove`, `start`, `matches`, `matches-clear`, `reset`, `redraw`, `standings`, `preview`, `draw`, `draw-confirm`, `schedule-generate`, `match-schedule`, `match-delete`, `match-result`, `deadline`
- Wichtige Lücken:
  - Keine bekannte Kernlücke im vorgesehenen CLI-Scope.
- Bewusste Ausschlüsse:
  - Turniere werden im V3-Domänenmodell kanonisch über execution-create aus einer Serie erzeugt; der direkte POST /tournaments wird nicht als redundante zweite Create-Action angeboten.
  - Öffentliche Anmeldung und öffentliche Bracket-Reads sind Frontend-/Self-Service-Aufgaben.
- Geprüfte Quellen: `src/commands/tournament.ts`
- Weiterführende Doku: `docs/turniere.md`

## sponsor

- Status: `core-partial`
- Actions: `list`, `show`, `add`, `update`, `logo`, `product-list`, `product-add`, `product-update`, `product-delete`, `contract-list`, `contract-add`, `assignment-list`, `assign`, `assignment-update`, `cancel`, `doc-list`, `doc-upload`, `responsible-list`, `responsible-add`, `responsible-update`, `responsible-remove`
- Wichtige Lücken:
  - Der marketing-service stellt für Advertiser kein DELETE und für bestehende Vertragsversionen nur GET/POST, aber kein PATCH/DELETE bereit; daher kann das CLI diese Mutationen nicht abbilden.
- Bewusste Ausschlüsse:
  - Globaler Anzeigenmarktplatz und Plattform-Abrechnung liegen außerhalb des lokalen Club-Sponsorings.
- Geprüfte Quellen: `src/commands/sponsor.ts`, `src/util/upload.ts`
- Weiterführende Doku: `docs/sponsoring.md`, `docs/dateien.md`
