# Meetings und Protokolle

Die Meeting-CLI deckt die fachlichen Club-Admin-Abläufe des `meeting-service` ab: Meeting-Serien, konkrete Protokolle/Sitzungen, Tagesordnung, Notizen, Teilnehmer, Entscheidungen, Abstimmungen, Beschlüsse und die offizielle Reinschrift.

```bash
comvenio meeting <action> [id] [optionen]
```

Für Agenten ist `--json` die verbindliche Ausgabeform. Komplexe Create-/Update-Bodies werden als JSON-Datei mit `--file <payload.json>` übergeben. Die CLI reicht diese Payload ohne Umbenennung von Feldern an den Backend-Vertrag weiter.

## Grundregeln

- `--club <id>` überschreibt den Club aus dem lokalen Login-State.
- `[id]` bezeichnet je nach Aktion die Serien-, Protokoll-, TOP-, Teilnehmer-, Entscheidungs-, Beschluss-, Eintrags- oder Anhang-ID.
- `--protocol <id>` ist nur für Carry-over-TOPs bei `agenda-start`, `agenda-complete` und `agenda-skip` nötig.
- Schreibende Aktionen werden vom Backend über `manage_meetings` beziehungsweise granulare Meeting-Rechte geschützt.
- Ein HTTP-Fehler ist kein leeres Ergebnis. Die CLI gibt Backend-Fehler mit Exit-Code ungleich null zurück.

## Schnellstart

Eine Meeting-Serie anlegen:

```json
{
  "club_id": "CLUB_UUID",
  "department_id": "DEPARTMENT_UUID",
  "title": "Monatliche Vorstandssitzung",
  "description": "Regeltermin des Vorstands",
  "meeting_type": "Vorstandssitzung",
  "default_protocol_type": "formal",
  "default_requires_approval": true,
  "default_protocol_summary_style": "results"
}
```

```bash
comvenio meeting series-create --file meeting-series.json --json
comvenio meeting series-list --json
```

Für einen konkreten Event-Termin ein Protokoll anlegen:

```json
{
  "meeting_id": "MEETING_SERIES_UUID",
  "event_id": "EVENT_UUID",
  "club_id": "CLUB_UUID",
  "department_id": "DEPARTMENT_UUID",
  "title": "Vorstandssitzung Juli 2026",
  "protocol_type": "formal",
  "requires_approval": true,
  "allow_public_join": false
}
```

```bash
comvenio meeting protocol-create --file protocol.json --json
comvenio meeting protocol-show PROTOCOL_UUID --json
```

## Meeting-Serien

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `series`, `series-list` | – | `GET /meetings/by_club/{club_id}` | – |
| `series-show` | Serien-ID | `GET /meetings/{id}` | – |
| `series-create` | – | `POST /meetings/` | `MeetingCreate` |
| `series-update` | Serien-ID | `PATCH /meetings/{id}` | `MeetingUpdate` |
| `series-delete` | Serien-ID | `DELETE /meetings/{id}` | – |

Pflichtfelder für `MeetingCreate`: `club_id`, `department_id`, `title`. Zulässige Werte für `default_protocol_summary_style`: `results`, `detailed`, `decision`, `short`, `action`, `custom`.

## Protokolle und Lifecycle

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `list`, `protocol-list` | – | `GET /protocols/?club_id={club_id}` | – |
| `show`, `protocol-show` | Protokoll-ID | `GET /protocols/{id}/view` | – |
| `protocol-create` | – | `POST /protocols/` | `ProtocolCreate` |
| `protocol-update` | Protokoll-ID | `PATCH /protocols/{id}` | `ProtocolUpdate` |
| `protocol-delete` | Protokoll-ID | `DELETE /protocols/{id}` | – |
| `protocol-advance` | Protokoll-ID | `POST /protocol-management/{id}/advance-phase` | – |
| `protocol-revert` | Protokoll-ID | `POST /protocol-management/{id}/revert-phase` | – |
| `protocol-updates` | Protokoll-ID | `GET /protocol-management/{id}/updates` | `--since <iso-datetime>` optional |
| `protocol-validation` | Protokoll-ID | `GET /protocol-validation/protocols/{id}/validation-status` | – |
| `protocol-publish` | Protokoll-ID | `POST /protocol-validation/protocols/{id}/publish` | – |

Der reale Vorwärts-Lifecycle im Backend ist:

```text
preparation_open → preparation_admin → agenda_finished → in_progress
→ finalized → protocol_generation → pending_approval → published
```

Beim Wechsel zu `in_progress` setzt das Backend `started_at`; beim Wechsel zu `finalized` setzt es `ended_at`. Die menschliche CLI-Liste zeigt deshalb `started_at` als Datum und Uhrzeit und erfindet kein nicht existentes `meeting_date`.

Wichtige Gates:

- `protocol_generation → pending_approval`: Für jeden behandelten TOP muss ein ProtocolEntry existieren.
- `protocol-publish`: Alle Validatoren müssen bestätigt haben.
- `protocol-revert` ist nicht für jede Phase erlaubt; der Backend-State-Machine-Check bleibt maßgeblich.

## Tagesordnung und Live-Status

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `agenda-list` | Protokoll-ID | `GET /agenda-items/protocol/{id}` | – |
| `agenda-show` | TOP-ID | `GET /agenda-items/{id}` | – |
| `agenda-create` | Protokoll-ID | `POST /agenda-items/protocol/{id}` | `AgendaItemCreate` |
| `agenda-update` | TOP-ID | `PATCH /agenda-items/{id}` | `AgendaItemUpdate` |
| `agenda-delete` | TOP-ID | `DELETE /agenda-items/{id}` | – |
| `agenda-reorder` | Protokoll-ID | `POST /agenda-management/protocol/{id}/reorder` | `ReorderRequest` |
| `agenda-start` | TOP-ID | `POST /agenda-management/{id}/start` | – |
| `agenda-complete` | TOP-ID | `POST /agenda-management/{id}/complete` | optional `CompleteRequest` |
| `agenda-skip` | TOP-ID | `POST /agenda-management/{id}/skip` | – |
| `agenda-approve` | TOP-ID | `POST /agenda-management/{id}/approve` | `ApproveRequest` |

Beispiele:

```json
{
  "title": "Kassenbericht",
  "description": "Auswertung des zweiten Quartals",
  "estimated_duration_minutes": 20,
  "is_hidden": false
}
```

```bash
comvenio meeting agenda-create PROTOCOL_UUID --file top.json --json
```

```json
{
  "item_positions": {
    "TOP_UUID_1": 0,
    "TOP_UUID_2": 1
  }
}
```

```bash
comvenio meeting agenda-reorder PROTOCOL_UUID --file order.json --json
comvenio meeting agenda-start TOP_UUID --protocol PROTOCOL_UUID --json
comvenio meeting agenda-complete TOP_UUID --protocol PROTOCOL_UUID --json
```

`--protocol` ist bei einem Carry-over-TOP wichtig, weil ein AgendaItem mehreren Protokollen zugeordnet sein kann.

## Notizen

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `note-list` | TOP-ID | `GET /agenda-notes/agenda-item/{id}` | – |
| `note-list-protocol` | Protokoll-ID | `GET /agenda-notes/protocol/{id}` | – |
| `note-create` | – | `POST /agenda-notes/` | `AgendaItemNoteCreate` |
| `note-update` | Notiz-ID | `PATCH /agenda-notes/{id}` | `AgendaItemNoteUpdate` |
| `note-delete` | Notiz-ID | `DELETE /agenda-notes/{id}` | – |

`note-create` benötigt `meeting_protocol_id`, `agenda_item_id`, `club_id`, `content` und `note_type`. Fachliche Werte für `note_type`: `admin`, `discussion`, `note`, `summary`; `taskupdate` wird nur über den speziellen Backend-Systemflow erzeugt und ist nicht für manuelle Notizen vorgesehen.

## Teilnehmer und Validierung

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `participant-list` | Protokoll-ID | `GET /participants/{id}` | – |
| `participant-add` | Protokoll-ID | `POST /participants/{id}` | `ParticipantCreate` |
| `participant-update` | Teilnehmer-ID | `PATCH /participants/{id}` | `ParticipantUpdate` |
| `participant-remove` | Teilnehmer-ID | `DELETE /participants/{id}` | – |
| `participant-validate` | Teilnehmer-ID | `POST /protocol-validation/participants/{id}/validate` | optional `ParticipantValidate` |
| `participant-unvalidate` | Teilnehmer-ID | `DELETE /protocol-validation/participants/{id}/validate` | – |

`ParticipantCreate` benötigt `protocol_id`, `club_id` und mindestens eine Identität: `user_id`, `member_id` oder `name`. `ParticipantUpdate` erlaubt ausschließlich `role` und `is_present`.

## Entscheidungen und Abstimmungen

Entscheidungen werden an einem TOP erstellt. Vollständige Decision-Daten eines TOPs liefert `agenda-show`; der Backend-Code besitzt keinen separaten Decision-Listen-/Detail-Endpunkt.

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `decision-create` | TOP-ID | `POST /decisions/agenda-item/{id}` | `DecisionCreate` |
| `decision-agenda` | Entscheidungs-ID | `GET /decisions/{id}/agenda-item` | – |
| `decision-update` | Entscheidungs-ID | `PATCH /decisions/{id}` | `DecisionUpdate` |
| `decision-cancel` | Entscheidungs-ID | `POST /decisions/{id}/cancel` | `--reason <text>` optional |
| `decision-option-add` | Entscheidungs-ID | `POST /decisions/{id}/options` | `VotingOptionCreate` |
| `decision-options-add` | Entscheidungs-ID | `POST /decisions/{id}/options/batch` | Array von `VotingOptionCreate` |
| `decision-promote` | Entscheidungs-ID | `POST /decisions/{id}/promote-to-resolution` | `--number <beschlussnummer>` |
| `voting-open` | Entscheidungs-ID | `POST /votes/{id}/open` | – |
| `voting-close` | Entscheidungs-ID | `POST /votes/{id}/close` | – |
| `voting-results` | Entscheidungs-ID | `GET /votes/{id}/results` | – |
| `voting-eligible` | Entscheidungs-ID | `GET /votes/{id}/eligible-voters` | – |
| `vote-cast` | Entscheidungs-ID | `POST /votes/{id}/cast` | `VoteCast` |
| `vote-cast-bulk` | Entscheidungs-ID | `POST /votes/{id}/cast/bulk` | `BulkVoteCast` |
| `vote-proxy` | Entscheidungs-ID | `POST /votes/{id}/proxy` | `VoteProxyCast` |
| `vote-proxy-bulk` | Entscheidungs-ID | `POST /votes/{id}/proxy/bulk` | `BulkProxyVoteCast` |
| `voting-tally` | Entscheidungs-ID | `POST /votes/{id}/offline-tally/{option_id}` | `--option <id> --count <n> [--increment]` |
| `vote-option-retract` | Entscheidungs-ID | `DELETE /votes/{id}/option/{option_id}` | `--option <id>` |
| `vote-retract` | Entscheidungs-ID | `DELETE /votes/{id}` | – |

Für `DecisionCreate` sind unter anderem `protocol_id`, `agenda_item_id`, `department_id`, `club_id`, `title`, `decision_type` und `valid_from` nötig. Entscheidungen dürfen nur für einen aktuell behandelten TOP erstellt werden. Stimmberechtigt sind nur anwesende Teilnehmer.

`voting-tally` ist ausschließlich für Offline-Abstimmungen gedacht. Ohne `--increment` setzt `--count` den absoluten Zählerstand; mit `--increment` wird die ganze Zahl als Delta addiert, beispielsweise `--count -1 --increment`. Bei einer Mehrfachauswahl entfernt `vote-option-retract` nur die eigene Stimme für die angegebene Option; `vote-retract` entfernt alle eigenen Stimmen dieser Entscheidung.

```json
{
  "agenda_item_id": "TOP_UUID",
  "protocol_id": "PROTOCOL_UUID",
  "department_id": "DEPARTMENT_UUID",
  "club_id": "CLUB_UUID",
  "title": "Budget 2027 freigeben",
  "decision_type": "voting",
  "voting_visibility": "public",
  "valid_from": "2026-07-13T19:30:00+02:00",
  "voting_eligibility": "all_participants",
  "allow_proxy_voting": true,
  "is_offline_voting": false,
  "allow_multiple_choice": false
}
```

## Beschlüsse

| Aktion | `[id]` | HTTP-Route | Payload/Optionen |
|---|---|---|---|
| `resolutions`, `resolution-list` | – | `GET /resolutions/?club_id={club_id}` | `--department`, `--category`, `--include-expired` |
| `resolution-list-protocol` | Protokoll-ID | `GET /resolutions/protocol/{id}` | – |
| `resolution-show` | Beschluss-ID | `GET /resolutions/{id}` | – |
| `resolution-history` | Beschluss-ID | `GET /resolutions/{id}/history` | – |
| `resolution-create` | – | `POST /resolutions/` | `ResolutionCreate` |
| `resolution-update` | Beschluss-ID | `PATCH /resolutions/{id}` | `ResolutionUpdate` |
| `resolution-approve` | Beschluss-ID | `POST /resolutions/{id}/approve` | `ResolutionApprove` |
| `resolution-decline` | Beschluss-ID | `POST /resolutions/{id}/decline` | `ResolutionDecline` |
| `resolution-delete` | Beschluss-ID | `DELETE /resolutions/{id}` | – |

Beschlussstatus: `new`, `accepted`, `declined`, `expired`. `resolution-decline` benötigt `approval_notes`; `resolution-approve` akzeptiert dieses Feld optional.

## Reinschrift und Anhänge

ProtocolEntries sind die offizielle Reinschrift in der Phase `protocol_generation`.

| Aktion | `[id]` | HTTP-Route | Payload |
|---|---|---|---|
| `entries`, `entry-list` | Protokoll-ID | `GET /protocol-entries/protocol/{id}` | – |
| `entry-show` | Eintrags-ID | `GET /protocol-entries/{id}` | – |
| `entry-show-agenda` | TOP-ID | `GET /protocol-entries/agenda-item/{id}` | – |
| `entry-create` | TOP-ID | `POST /protocol-entries/{id}` | `ProtocolEntryCreate` |
| `entry-update` | Eintrags-ID | `PUT /protocol-entries/{id}` | `ProtocolEntryUpdate` |
| `entry-delete` | Eintrags-ID | `DELETE /protocol-entries/{id}` | – |
| `attachment-list` | Eintrags-ID | `GET /protocol-entries/{id}/attachments` | – |
| `attachment-add` | Eintrags-ID | `POST /protocol-entries/{id}/attachments` | `{ "file_id": "..." }` |
| `attachment-remove` | Anhang-ID | `DELETE /protocol-entries/attachments/{id}` | – |

`entry-create` benötigt `meeting_protocol_id`, `content` und optional `is_ai_generated`. Anhänge verknüpfen eine bereits im Content-Service vorhandene `file_id`; die CLI lädt an dieser Stelle keine Datei hoch.

## Bewusst ausgeschlossene Routen

Die folgenden Backend-Bereiche sind keine allgemeinen Club-Admin-CLI-Workflows und werden absichtlich nicht angeboten:

- `/internal/*`: Service-to-Service-Wartung mit internem Auth-Vertrag.
- `/meeting-access/*`, `/protocols/*/join` und öffentliche/persönliche Token-Routen: Browser-/Einladungszugang, kein Admin-Automationsflow.
- `/meeting-assistant-suggestions/*` und `/agenda-task-suggestion-drafts/*`: private AI-Assistenten-Drafts mit eigenem Bestätigungs- und Berechtigungskontext.
- `taskupdate`-Systemnotizen: werden vom Task-/Meeting-Workflow erzeugt, nicht manuell.

Die CLI stellt diese technischen und sicherheitskritischen Spezialrouten nicht als generischen Raw-HTTP-Ausweg bereit.

## Quellenstand

Diese Referenz ist gegen die lokalen Router und Pydantic-Schemas unter `Backend/Microservice-Backend/meeting-service/app/routes/` und `app/schemas/` geprüft. Die maschinenlesbare Kurzfassung liegt in `src/schema/meeting.json`.
