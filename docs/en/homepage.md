---
id: homepage
kategorie: thema
domaenen: [homepage]
stichwoerter: [homepage, website, club-site, widgets, design]
---

# Building the club homepage

## Purpose

The CLI builds and maintains the public club homepage: structure, content
and design are described as declarative JSON, checked in a preview and
published only after explicit approval. There is no automatic text or
design generator running in the background — whoever designs the page
composes it themselves through the actions described here.

## Requirements and permissions

Sign in with `comvenio login`; which actions your club has enabled and which
scopes they need is shown by `comvenio action list --json`.

```bash
comvenio login
comvenio whoami --json
```

The club comes from the signed-in context — it is not set through the
input, the CLI rejects a supplied club id.

Design and publishing steps (`cai.club.05.design`, `cai.homepage.02.apply`)
need the permission to manage club settings (scope `club.write`). Without
it, Comvenio reports `PERMISSION_DENIED` — an administrator of the club
grants that permission. If the sign-in is missing the required scope,
Comvenio reports `SCOPE_REQUIRED` with the matching
`comvenio login --scopes …` command.

## Workflows

### Tool chain

Every change follows the same order: read the contracts → read the current
state → compose structure and design → generate a preview → run the check →
get approval → apply and confirm. No step is skipped, and
`cai.homepage.02.apply` with `clear_existing: true` never runs without
explicit approval.

### Reading contracts and current state

```bash
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"homepage"}' --json > homepage-schema.json
comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"design"}' --json > design-schema.json
comvenio action call cai.homepage.03.show --input '{"operation":"public"}' --json
```

The homepage schema is authoritative for the available widget kinds and
their config fields, for section layouts and style variants, for the public
detail routes for news and events, for safe button targets, and for the
non-configurable, always identical frame of the page. Unknown fields, widget
kinds or values are never invented — they are looked up in the schema.

### Unchangeable areas of the page

Only the actual homepage content is configured. Independent of the `tabs`
content, every club page always shows:

| Element | Fixed target |
|---|---|
| Legal notice | the homepage's own legal notice page |
| Privacy policy | Comvenio's central privacy page |
| Terms | Comvenio's central terms page |
| "Powered by Comvenio" | the Comvenio homepage |

The legal notice draws its details automatically: first from the club's
stored contact details (address, email, phone, website), falling back to the
public club master data when those are empty. Club name, legal form and
register number also come from the master data. A different responsible
party can be stored; if none is set, it defaults to "owner of the club" with
the note that the club is responsible for the content. If the public
homepage is switched off in the club's features, the legal notice page no
longer returns contact details. Never output publicly: payment data, bank
details, tax numbers, member or user identifiers, or internal audit fields.

Forbidden as a result: a dedicated mandatory "legal" tab, a content widget
treated as the source of the legal notice, duplicated mandatory links inside
free-form HTML, and hiding or redirecting the legal footer via custom CSS.
An older content block for legal notices exists only for backward
compatibility.

### Building the page structure

A homepage consists of tabs, each tab of sections, each section of widgets.
The full structure is submitted as the `tabs` array in the input of
`cai.homepage.01.preview` and `cai.homepage.02.apply` (see Examples). The
`clear_existing` (default `false`) controls what happens to the existing
content: `false` only **adds** the given tabs (a slug that already exists
gets `-2`); existing tabs, sections and widgets stay unchanged. Changing an
existing text — such as the welcome text of the start page — therefore
means: read the current content with `cai.homepage.03.show`, change the spot
in the complete structure and publish everything with
`clear_existing: true` through preview and confirmation.

### Designing content

- **Image gallery** (`image_gallery`): source is either hand-picked files,
  public club images, the images of one event, the last three completed
  public events, a folder, or external addresses; `limit` 1–50, default 24.
  Only public, finished, active images of the same club appear; cover
  images, flyers and logos of an event are left out. The folder source only
  shows a folder's publicly released view, never a private file store.
  Already-issued, time-limited image addresses may keep showing a recently
  changed permission for a while.
- **Downloads** (`files` with `source=files`): a fixed set of file
  identifiers shows specific documents, for example an application form. An
  empty selection shows no other club files.
- **Ticker** (`ticker`): `show_events`, `show_news`, `show_birthdays`,
  `news_limit`, `events_limit`. Birthdays are only shown after explicit
  agreement with the club, and always only with first name plus day and
  month. Speed is controlled with `speed_px_per_second` (10–150; a medium
  speed is around 55) and stays constant regardless of content length.
- **Contact form** (`contact_form`): name, email, message, consent and spam
  protection. Requests are stored, the board is notified, the club handles
  them in the club area of the web app. The preview does not send anything.
  An older, purely informational membership form does not confirm a
  successful application and must not be treated as one; `contact_form` is
  the only widget intended for contact and membership interest. Rebuilding a
  form from free-form HTML is not supported. Stored requests are permanently
  removed 30 days after deletion, and at the latest 365 days after they were
  received.
- **Club body** (`team` with `group_id`): shows the positions of a club body
  with current names; default positions are excluded. Clarify with the club
  first, because a saved, public body widget makes the body's names public.
  Even unfilled, non-default positions appear with their position
  description and a "not filled" note — a data source that is temporarily
  unavailable is never shown as an unfilled position. Public Comvenio
  profile pictures are only requested with `show_avatar`; missing pictures
  are allowed. A saved body widget on a public, active page exposes that
  body — no separate release switch is needed; private pages, hidden
  sections and deleted widgets expose nothing. Order and highlighting of
  positions can be set with `position_order` (position ids from top to
  bottom — positions left out follow the body's own order, unknown ids are
  ignored) and `highlighted_position_ids` (color-highlighted cards); the
  matching ids come from the club's position and body lookups.
- **Event list** (`events_list`): `time_scope` distinguishes past events
  (most recently finished first), upcoming events and all events. Recap and
  outlook can be designed as two separate widgets.
- **Date inline in text** (`event_highlight` with `layout: "date"`): embeds
  an event date as inline text instead of a card — color and font come from
  the surrounding layout. The event id is required here; `date_format` is
  `full` (full range), `days` (day counts) or `month-year`; a change of
  month or year always shows the full range. If the event is unavailable, no
  hard-coded fallback date is shown. `series_id` instead shows the next
  published event of a series — the `weekday-time` and `time` formats suit
  recurring club evenings; what is shown is always a real, already scheduled
  date, never a repetition assumed from text.
- **Club logo in the image widget** (`image` with `source=club_logo`): pulls
  in the current club logo and takes priority over any stored file or
  address; a logo change takes effect on the next fetch.
- **Full-screen video** (`background_video`): layout `cover` (default) puts
  the video as a full-screen background behind the section content, layout
  `spotlight` shows it as a framed highlight card on a branded surface with
  its own logo, title and teaser fields (details in Examples). Always
  reference media through a file id — a directly given address is only a
  short-lived fallback and can expire.
- **Full-screen landing page**: `custom_template_config.landing` (default
  `false`) switches a section into a bare full-screen mode for pure teaser
  or campaign pages — no header, no navigation, no default hero. The legal
  footer is unaffected and always stays visible. Without navigation, other
  tabs are unreachable for visitors — a deliberate choice for pure teaser
  pages, not a bug.

### Skeleton and named slots

For free-form HTML (`custom_html`) a fixed pattern applies: the HTML is only
a skeleton, every changeable piece of content is a named slot. Only this way
can the page be composed as a tree of headings, text, images and buttons.

- Exactly one full-width section with exactly one `custom_html` widget per
  tab, acting as the skeleton. It carries only layout — elements, classes,
  and a labeling attribute per area.
- Every piece of content is a named slot: `heading` (text, line breaks
  allowed), `text` (simple HTML with bold, italic, links, paragraphs and
  lists), `link` (label, target, new tab); live data such as ticker, news,
  event list, date, club body, image gallery, downloads, image, video and
  contact form are likewise represented as a slot of their kind. Slot names
  consist of lowercase letters, digits and hyphens, start with a letter or
  digit, are at most 63 characters long, and are unique per tab.
- An image slot placed directly on an image element only fills address and
  alt text; class, size and loading behavior stay in the skeleton. An image
  slot on a wrapping element is instead the full image widget with its own
  box. Accepted are secure addresses, uploaded files and embedded image
  data; anything else shows no image.
- Addressing and setting a single slot is not yet available as an action —
  do this in the web app. Through actions, the full `tabs` structure is
  instead resent with `cai.homepage.02.apply`.
- Styles meant to be switched later are registered as a catalog and then
  assigned as a `style` on the slot instead of a fixed class in the
  skeleton. Colors and column counts meant to be adjustable are likewise
  registered as a token or attribute, not as fixed values in CSS.
- Elements can be placed side by side as a "row": a container with a fixed
  column count and percentage widths is shown side by side from a medium
  screen width upward, and stacked below that (example below). The widths are
  2 to 4 whole percentage values in steps of 5, each at least 20, summing to
  100, and matching the column count — an invalid value is discarded, and the
  columns fall back to equal width. A row inside a row is not supported. A
  section with a multi-column layout and matching width values acts
  equivalently as a row.
- An existing skeleton in the older format — fixed text and images directly
  in the HTML instead of in slots — stays readable. The detected format per
  tab does not show as an action yet — do this in the web app. Converting to
  the new format itself runs through `cai.homepage.05.convert`: it reads the
  current live structure, converts every skeleton and returns `tabs` ready
  for `cai.homepage.02.apply`, plus a report (`umgewandelt`, `offene_stellen`,
  `katalogklassen_verschoben`, `befunde`). Nothing is applied by this —
  that stays `cai.homepage.02.apply` after explicit approval.
- A skeleton with fixed text or an image outside a slot, without a unique
  slot name, without an area label, with an unknown style, or with more than
  one main heading is rejected when written.

### Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Header and navigation are missing live, the preview still showed them | an older landing mode survived in the design settings | write `"landing": false` explicitly into `design_settings` and apply again |
| Dark border or shadow around a cut-out logo | the image widget draws a card by default | explicitly turn off the card style on the image slot (`card_style` field set to `none`) |
| A portrait crest looks cropped in the round header | older version of the display | use the current version; upload the logo square or transparent |
| "No image configured" for only one person | an old state sits in the browser cache | fully reload the page |
| Custom CSS for a width has no effect | the rule targets a class the slot does not carry | inspect the actual structure in the preview and target the right container |
| The check reports a finding only on one event page | contrast issue in an embedded external page | note it separately, don't "fix" it via the homepage design |
| A club body shows many "not filled" | positions in the club aren't assigned | maintain the club data, don't paper over it in the display |

### Preview and checking

```bash
comvenio action call cai.homepage.01.preview \
  --input '{"tabs":[{"label":"Home","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":false}' \
  --json
# the response contains preview_id

comvenio action call cai.homepage.04.screenshot \
  --input '{"preview_id":"<preview-id>","viewports":["mobile","desktop"]}' \
  --json

comvenio action call cai.verify.04.homepage \
  --input '{"operation":"preview","tabs":[{"label":"Home","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

`cai.homepage.01.preview` never changes the published page.

With `"operation":"live"` instead of `"operation":"preview"`,
`cai.verify.04.homepage` instead checks the club's published address —
without `tabs`. That address is derived exclusively from the club's stored
subdomain; other technical identifiers are not a homepage address and are
never used as a fallback.

The check covers every public tab, the separate legal notice page and the
given `viewports` — `mobile` and `desktop`, both when omitted —, plus horizontal overflow and
empty main regions, invisible text and contrast, console and network errors,
the fixed legal footer with all its targets, operability of every mandatory
link, and the club's stated responsibility plus at least one public contact
detail on the legal notice page. Text over image, video or gradient surfaces
is not measurable by nature and is therefore never counted as a finding.

The response reports findings instead of a plain pass/fail. Screenshots and
the report always come before human approval.

### Publishing

Only after explicit approval, and only after backing up the current state —
`clear_existing: true` replaces every existing tab, section and widget.
`cai.homepage.02.apply` is a critical change: the call first returns a
preview with `preview_id` and `confirmation_token`; only `action confirm`
actually publishes the page.

```bash
comvenio action call cai.homepage.03.show \
  --input '{"operation":"public"}' \
  --json > backup-home.json

comvenio action call cai.club.05.design \
  --input '{"design_settings":{"homepage_theme":"modern","homepage_template":"flex","primary_color":"#006846"}}' \
  --json

comvenio action call cai.homepage.02.apply \
  --input '{"tabs":[{"label":"Home","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"clear_existing":true}' \
  --json
# the response contains preview_id and confirmation_token
comvenio action confirm \
  --preview-id <preview-id> \
  --confirmation-token <token> \
  --idempotency-key <key>

comvenio action call cai.homepage.03.show --input '{"operation":"public"}' --json
comvenio action call cai.verify.04.homepage \
  --input '{"operation":"live","viewports":["mobile","desktop"],"audit":true,"wait_ms":500}' \
  --json
```

`cai.club.05.design` merges instead of replacing: a key that is set live and
missing from the input is kept — even though the preview does not show it,
because it only renders the given `tabs`. That applies in particular to an
old full-screen landing mode: the published page then loses its header and
navigation even though the preview looked correct. For a normal page,
`"landing": false` is therefore always passed explicitly in
`design_settings`.

After applying, the published page is checked visually (header, navigation,
hero, mobile view). Anyone who already had the page open beforehand may
briefly see an older state after publishing — a full reload of the page
fixes that.

### Mobile devices

Every section wraps on smaller screens: grids become single-column, buttons
wrap instead of overflowing. Hero graphics are not simply hidden on phones
but deliberately designed — for example a semi-transparent crest next to the
headline. At 390 pixels width, no horizontal overflow may occur.

## Examples

Basic structure with one tab, one section and one hero widget (as the
`tabs` value of `cai.homepage.01.preview` or `cai.homepage.02.apply`):

```json
{
  "clear_existing": false,
  "tabs": [
    {
      "label": "Home",
      "slug": "start",
      "position": 0,
      "visibility_scope": "public",
      "sections": [
        {
          "layout": "full",
          "style_variant": "default",
          "sort_order": 0,
          "is_visible": true,
          "widgets": [
            {
              "kind": "hero",
              "slot_index": 0,
              "config": {
                "headline": "Welcome",
                "cta_primary_label": "News",
                "cta_primary_url": "?tab=news"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Two teams permanently side by side, as two aligned sections (the full fields
of the FuPa widget are in the schema; `widgetId` is required there, `title`,
`includeSrc`, `hrefUrl`, `hrefLabel`, `height` and `show_title` are
optional):

```json
[
  {
    "layout": "two-col",
    "title": "Standings",
    "widgets": [
      { "kind": "fupa_widget", "slot_index": 0,
        "config": { "widgetId": "<standings-first>", "title": "Standings · 1st team" } },
      { "kind": "fupa_widget", "slot_index": 1,
        "config": { "widgetId": "<standings-second>", "title": "Standings · 2nd team" } }
    ]
  },
  {
    "layout": "two-col",
    "title": "Next matches",
    "widgets": [
      { "kind": "fupa_widget", "slot_index": 0,
        "config": { "widgetId": "<matches-first>", "title": "Next matches · 1st team" } },
      { "kind": "fupa_widget", "slot_index": 1,
        "config": { "widgetId": "<matches-second>", "title": "Next matches · 2nd team" } }
    ]
  }
]
```

Complete `design_settings` object (for `cai.club.05.design`):

```json
{
  "homepage_theme": "modern",
  "homepage_template": "flex",
  "primary_color": "#006846",
  "secondary_color": "#2B241D",
  "accent_color": "#D3A52D",
  "custom_template_config": {
    "landing": false,
    "public_header": { "layout": "brand-left", "surface": "light", "density": "comfortable", "sticky": true }
  },
  "custom_css": ".vw-page{...}"
}
```

Custom CSS only applies within the page itself; custom classes carry a club
prefix, colors are set as variables on the page's root element.

Date embedded inline in running text:

```html
<span data-widget-slot="event_highlight"
      data-widget-config='{"event_id":"<event-id>","layout":"date","date_format":"full","date_timezone":"Europe/Berlin"}'></span>
```

Spotlight video configuration (in addition to file/address, poster image,
overlay, loop and headline):

| Field | Meaning |
|---|---|
| `layout` | `cover` or `spotlight`, default `cover` |
| `background` | background of the branded surface behind the video card |
| `accent_color` | accent color for highlighted words in the title |
| `text_color` | text color on the surface |
| `logo_file_id` | emblem on the left |
| `logo_right_file_id` | second emblem or sponsor logo on the right |
| `eyebrow` | kicker line above the title |
| `title` | headline, one marked word appears in `accent_color` |
| `date_badge` | pill badge, for example date or place |
| `claim` | closing line under the video card, line breaks allowed |

A row with two unevenly sized columns in the skeleton:

```html
<div data-reihe data-spalten="2" data-breiten="65 35">
  <div><!-- first slot content --></div>
  <div><!-- second slot content --></div>
</div>
```

Reading and setting a single slot, and swapping only the skeleton of an
existing widget, are not yet available as an action — do this in the web
app.

## Commands and actions

<!-- gen:docs befehle -->

**homepage**

- `cai.homepage.01.preview` — preview (read) · Scopes: `club.write`
- `cai.homepage.02.apply` — apply (change with confirmation) · Scopes: `club.write`
- `cai.homepage.03.show` — private, public (read) · Scopes: `club.read`, `public.read`
- `cai.homepage.04.screenshot` — screenshot (read) · Scopes: `club.write`
- `cai.homepage.05.convert` — convert (read) · Scopes: `club.write`
- Fields and values: `comvenio action call cai.schema.02.show_domain_schema --input '{"domain":"homepage"}'` (the sign-in sets `club_id` — never in `--input`)
<!-- /gen:docs -->

## Widgets

Every widget from the homepage schema with its kind, purpose, data source,
what it makes public and what it fits — grouped by category. An open item
instead of an explanation means: the widget is not documented yet, not an
invented claim.

<!-- gen:docs widgets -->

**inhalt**

- `hero` — Large title area at the top of the page with headline, background and call-to-action. Data source: Text and background from the form; if enabled, also aggregated Comvenio figures for the club (member count, number of upcoming events, founding year from the club's master data). Makes public: The entered texts and, if switched on, only aggregate numbers (total member count, number of upcoming events) — no names or individual records. Fits: Homepage
- `description` — Prose, quote or callout block for free-form club text. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Club page, any page
- `custom_html` — Embedded HTML fragment for free-form design not covered by another widget. Data source: fixed input in the widget form (raw HTML entered by the club administration). Makes public: Exactly the entered HTML — the administration can embed arbitrary content through it; the widget itself does not read any Comvenio data. Fits: any page
- `stats` — Metric tiles (e.g. member count, departments, events) as cards or a grid. Data source: Selectable per tile: fixed form input, or automatically from Comvenio data (total member count, number of departments, events this year) via the public count endpoints. Makes public: Only aggregate numbers (e.g. total member count) — no names or individual records. Fits: Homepage, Club page
- `cta` — Prominent call-to-action block with one or two buttons. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `contact` — Contact card with address, phone, email, opening hours and social links. Data source: fixed input in the widget form Makes public: The club's contact details entered in the form; personal data only if the administration enters some itself (e.g. a private phone number instead of a club number). Fits: Homepage, Club page, Contact page
- `legal_notice` — Legal notice (imprint) and legal information for the club. Data source: fixed input in the widget form Makes public: The entered legal club details (name, address, legal representative, register entry) — deliberately published by the club to meet its legal disclosure duty. Fits: Legal notice page, any page
- `faq` — Frequently asked questions as an accordion, grid, two-column list or searchable list. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Club page
- `sponsors` — Sponsor and partner logos as a grid, marquee or carousel. Data source: fixed form input (name/logo/website per sponsor); if the form instead references stored advertising partners, the widget automatically fetches their public sponsor data (company name, logo, website, verified flag). Makes public: Sponsor company data (name, logo, website) — no personal data. Fits: Homepage, Club page
- `countdown` — Countdown to a fixed target date. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Event page
- `club_history` — Club history as a timeline of year entries. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Club page, About page
- `contact_form` — Contact form for enquiries from visitors. Data source: Input from the enquiring person in the form (name, email, message, consent). Makes public: Sends the submitting person's name, email address, message and the timestamp of their given consent to the club (club service); the club administration then processes the enquiry there. Fits: Contact page, Homepage

**news**

- `news` — List of the club's latest news articles. Data source: The club's Comvenio news data (publicly released articles), optionally filtered by department. Makes public: Title, teaser text/image and, if enabled, the author of published news articles — only what the editors have already published as news. Fits: Homepage, News page
- `news_highlight` — A single highlighted news article in a large presentation. Data source: Comvenio news data (the news article chosen in the form, optionally filtered by department). Makes public: Title, text/image and author of the chosen news article — same as the news widget. Fits: Homepage, News page
- `ticker` — Marquee ticker cycling through short items from events, news and birthdays. Data source: Public Comvenio data: upcoming events, news and birthdays — each source can be switched on separately. Makes public: Same as the individual widgets: events and news as there; birthdays only for members who opted in, showing only first name and day/month without the birth year. Fits: Homepage, any page

**veranstaltungen**

- `events_list` — List of upcoming or past club events. Data source: Comvenio event data (the club's public event series), optionally filtered by department. Makes public: Title, date and location of public events — no attendee lists. Fits: Homepage, Event page, Department page
- `event_highlight` — A single highlighted event with an optional live countdown. Data source: Comvenio event data: the event chosen in the form, or a chosen recurring series whose next upcoming public occurrence is shown automatically. Makes public: Title, date/time and location of the chosen event. Fits: Homepage, Event page
- `event_hub_embed` — Embeds the full public event detail page (event hub) of one event — including programme, images and RSVP. Data source: Comvenio event data via the public event hub (internally this widget builds on the same building block as the "event with programme" widget and reads the event chosen in the form from the same configuration). Makes public: Everything the embedded event hub shows publicly: title, time span, location, programme, public images and the logged-in visitor's own RSVP status — no data about other attendees. Fits: Event page
- `event_calendar` — Monthly calendar of club events. Data source: Comvenio event data (public events), optionally filtered by department. Makes public: Title, date and location of public events — no attendee lists. Fits: Event page, Department page
- `event_program` — Running order of a single event as a timeline or cards. Data source: Comvenio event data: the programme items of the event chosen in the form. Makes public: Title, time and, if enabled, area of each programme item — no names of the people responsible (that field exists in the schema but is not read by this widget). Fits: Event page
- `event_rsvp` — RSVP block for an event showing the visitor's own invitation status. Data source: Comvenio event data: the logged-in person's own invitation to the event chosen in the form. Makes public: Only the logged-in person's own response (accepted/waitlisted, waitlist position if applicable) — no information about other members. Fits: Event page
- `training_schedule` — Training schedule as a table or timeline. Data source: Primarily fixed form input (entries per training slot); on the public page, if no entry is configured, it falls back to the club's public recurring Comvenio training sessions. Makes public: The entered or public training times and locations — no attendee lists. Fits: Department page, Event page
- `special_event_promo` — Embeds the full public event detail page (event hub) of one event — programme, images, news and RSVP. Data source: Comvenio event data via the public event hub for the event chosen in the form; the hub fetches its own data via Comvenio's public endpoints. Makes public: Everything the event hub shows publicly: title, time span, location, programme, public images and the logged-in visitor's own RSVP status — no data about other attendees. Fits: Event page
- `feature_grid` — Tile grid with an icon, label and detail text per tile (e.g. programme highlights or features). Data source: fixed form input; without any entries the widget shows a fixed set of demo tiles. Makes public: nothing beyond what was entered Fits: Homepage, Event page
- `department_calendar` — A department's calendar of events, training, bookings and meetings. Data source: fixed form input (events per entry with title, date, type); a field for filtering by department exists in the form but is currently not evaluated by the widget. Makes public: nothing beyond what was entered Fits: Department page

**mitglieder**

- `team` — A group's board/team with photo, name and role. Data source: Comvenio member data: public governance/officer data of the group chosen in the form, optionally filtered by department. Makes public: First and last name plus role(s) of that group's officers, and — if enabled — a profile photo; no contact details such as email or phone unless separately released. Fits: Club page, Department page, About page
- `org_chart` — Club organisation chart with departments and officers. Data source: Comvenio member data: the club's public organisation tree, positions and departments, optionally starting from a root department chosen in the form. Makes public: First and last name plus role of people in board/leadership positions, and the department structure — no contact details. Fits: Club page, About page
- `birthdays` — List of upcoming member birthdays. Data source: Comvenio member data: public birthdays — only members who have explicitly opted in to publishing their birthday. Makes public: Only the first name plus day and month (no birth year, no last name) of members who opted in. Fits: Homepage, Club page
- `birthday_highlight` — Celebratory highlight of the next upcoming birthday. Data source: Comvenio member data: public birthdays — only members who opted in. Makes public: Only the first name plus day and month (no birth year, no last name); if enabled, also the age reached as a milestone badge — again only for members who opted in. Fits: Homepage
- `honors_showcase` — Member honours and awards as a timeline, grid or spotlight display. Data source: Comvenio member data: the club's public honours. Makes public: First and last name of the honoured person, the honour's title/type, milestone years if applicable, and the date honoured — this is personal data the club deliberately publishes as recognition. Fits: Club page, Homepage
- `membership_form` — Form for a digital membership application. Data source: Input from the interested person in the form (name, contact details, chosen department, message). Makes public: Currently nothing: on submission, the widget explicitly shows an error message that no digital application channel is set up yet, and it neither transmits nor stores the entered data. Fits: Homepage, Club page
- `honor_wall` — Wall of honour listing member awards, an alternative presentation to honors_showcase. Data source: Comvenio member data: the club's public honours. Makes public: First and last name of the honoured person, the honour's title/type, milestone years if applicable, and the date — deliberately published by the club as recognition. Fits: Club page, Homepage

**medien**

- `image` — A single image or file with a caption. Data source: A file selected in the form from the club's public file area, or an external image URL, or optionally the club's current logo. Makes public: Only files already marked public and finished, or the entered image — no internal/private files. Fits: any page
- `image_gallery` — Image gallery as a grid, masonry layout, carousel or filmstrip. Data source: Depending on the source chosen in the form: selected files from the file area, images of a chosen event, images from the last three public events, a folder from the file area, external image URLs, or public club images. Makes public: Only images already marked public from the chosen source. Fits: Media page, Homepage, Event page
- `video` — Embedded video with a poster image. Data source: fixed form input (video URL, e.g. YouTube/Vimeo/MP4, and poster image URL). Makes public: nothing beyond what was entered Fits: Media page, any page
- `background_video` — Video or image as a full-bleed background section with text overlaid. Data source: fixed form input (video/image URL or uploaded file id, texts). Makes public: nothing beyond what was entered Fits: Homepage
- `files` — List of downloadable files (e.g. bylaws, forms). Data source: Files selected in the form from the club's public file area. Makes public: File name, type, size and description of the selected files already marked public — their content is the club administration's own responsibility. Fits: Club page, any page
- `gallery_slideshow` — Automatically advancing image slideshow with a transition effect. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Media page, Homepage

**buchung**

- `booking_highlight` — Highlighted bookable objects (e.g. courts, rooms) with a short description. Data source: Comvenio object data: the club's public object highlights, optionally limited to objects chosen in the form. Makes public: The object's name, type, description and whether booking needs approval — no names of the people booking. Fits: Homepage, Booking page
- `menu_display` — Menu/offering for an event or occasion. Data source: Comvenio catering data: the club's public menu. Makes public: Dishes/drinks with description and, if enabled, price — no personal data. Fits: Event page, Homepage

**extern**

- `instagram` — Embedded Instagram feed or link. Data source: External embed of the given Instagram account/link — no Comvenio data; Instagram itself loads and displays the content directly in the visitor's browser. Makes public: Nothing from Comvenio; Instagram itself receives technical browser data (e.g. IP address) when the embed loads, per Instagram/Meta's own privacy policy. Fits: Homepage, Social media page
- `facebook` — Embedded Facebook page or Facebook link. Data source: External embed of the given Facebook page/link — no Comvenio data. Makes public: Nothing from Comvenio; Facebook/Meta itself receives technical browser data when the embed loads, per Meta's own privacy policy. Fits: Homepage, Social media page
- `fupa_widget` — Embedded FuPa sports widget (results/table). Data source: External embed of the widget script provided by FuPa via the given widgetId — no Comvenio data. Makes public: Nothing from Comvenio; FuPa itself receives technical browser data when the embed loads, per FuPa's own privacy policy. Fits: Sports page, Department page
- `bfv_widget` — Embedded BFV sports widget (results/table of the Bavarian Football Association). Data source: External embed of the widget script provided by BFV via the address given in the form — no Comvenio data. Makes public: Nothing from Comvenio; BFV itself receives technical browser data when the embed loads, per BFV's own privacy policy. Fits: Sports page, Department page

**layout**

- `divider` — Decorative divider between two sections (wave, mountain, zigzag, etc.). Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `spacer` — Blank or decorative spacing between sections. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `parallax_section` — Image section with a parallax/zoom/fixed effect and optional text/CTA. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, any page
- `gradient_section` — Gradient/mesh section with optional text. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `decorative_element` — Purely decorative element (shapes, confetti, badges, quote) without its own content data. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `heading` — Basic building block: a single heading as a named slot. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `text` — Basic building block: a single text paragraph as a named slot. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
- `link` — Basic building block: a single link/button as a named slot. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page

**community**

- `testimonials` — Testimonials/quotes from members, parents or partners as a carousel, grid or stack. Data source: fixed form input (quote, author, role, image, rating per entry). Makes public: Only what the club administration enters here manually — if it names someone, that is a deliberate choice to publish that name; the widget does not read any Comvenio member data automatically. Fits: Homepage, Club page
- `logo_marquee` — Marquee of partner/cooperation logos. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Club page
- `image_text_split` — Image beside text with a heading and an optional button. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, any page
- `forum_highlight` — Preview of the latest public forum posts. Data source: Comvenio forum data: public threads and boards of the club forum — a deliberately publicly accessible area. Makes public: Title, text preview and stats (replies, views) of the public posts; as the author it shows only the first eight characters of the internal user id, never a real name. Fits: Homepage, Club page
- `chat_preview` — Preview of a few chat/forum messages with a link to the full chat. Data source: fixed form input (messages per entry: text, sender, time); a board chosen in the form only controls where the "Go to chat" link leads for logged-in members, but does not itself supply any live messages. Makes public: Only what the club administration enters here manually — no real, live chat messages. Fits: Homepage, Club page

**sport**

- `tournament_highlight` — Tournament scoreboard, fixture list or standings table. Data source: fixed form input (matches/standings per entry); optionally references a Comvenio tournament chosen in the form. Makes public: Only the entered match/standings data (team names, results) — no personal data of individual players. Fits: Sports page, Department page
- `sport_api` — Sports data from an external provider (table, results, next match) or an embedded provider widget. Data source: Depending on the provider chosen in the form: either fixed form input (table/results), or an external embed of FuPa/BFV/nuLiga via the given address — no Comvenio data. Makes public: With fixed input, only the entered data; with an external embed, that provider receives technical browser data when it loads, per its own privacy policy. Fits: Sports page, Department page
- `live_match_ticker` — Live match ticker for an ongoing tournament. Data source: fixed form input (matches per entry) or, if a Comvenio tournament is chosen in the form, that tournament's live data with optional highlighting of the club's own team. Makes public: Team names and scores — no personal data of individual players. Fits: Sports page, Department page

**live-daten**

- `member_counter` — Counter for member count and departments. Data source: Comvenio member data — but on the public page the widget deliberately shows no data at all: it only displays "Only visible to logged-in members.", with the query disabled there. Makes public: Nothing — the public page only shows the notice text, no number. Fits: internal only (admin preview)
- `department_showcase` — Overview of the club's departments. Data source: Comvenio department data — but the query is disabled on the public page (enabled: !isPublic); there the widget always shows the empty state "No departments". Makes public: Nothing — on the public page the widget currently loads no department data and only shows the empty state. Fits: internal only (admin preview)
- `next_training` — The next upcoming training session. Data source: Comvenio event data: the public next training session, optionally filtered by department. Makes public: Title, location and time of the next public training session — no attendee lists. Fits: Homepage, Department page
- `booking_calendar` — Availability calendar of a bookable object. Data source: Comvenio object data: public object highlights for the object chosen in the form. Makes public: The object's name and type, and whether booking needs approval — no names of the people booking or details of individual time slots. Fits: Booking page
- `meeting_decisions` — List of meeting decisions with the vote outcome. Data source: fixed input in the widget form Makes public: Only what the club administration enters here manually (title, meeting name, date, status, vote counts if any) — no automatic Comvenio connection to real meetings. Fits: Club page
- `quick_links` — List of quick links/tiles to important destinations. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, any page
- `poll` — Simple poll with answer options. Data source: fixed form input (question, answer options, optional fixed starting vote count per option). Makes public: Nothing personal: a cast vote is only held locally in the voter's own browser (no Comvenio backend, no storage, no link to the person) and is lost again on page reload. Fits: Homepage, Club page

**interaktion**

- `recipe_highlight` — Highlighted recipe (e.g. clubhouse kitchen). Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Club page
- `task_overview` — Task list with a done/open status. Data source: fixed input in the widget form Makes public: Only what the club administration enters here manually — no automatic Comvenio connection to the real task system. Fits: Club page, Department page
- `activity_feed` — Chronological feed of recent club activity (events, tournaments, news). Data source: Comvenio data: the club's public, aggregated feed of events, tournaments and news. Makes public: Title, timestamp and image (if any) of the respective events/tournaments/news — despite its name, no activity of individual members (no join, no login, etc.). Fits: Homepage, Club page
- `member_spotlight` — Spotlighted member with photo, role and quote. Data source: fixed form input (name, image, department, member since, quote). Makes public: Only what the club administration enters here manually — with the spotlighted member's consent, no automatic Comvenio member-data connection. Fits: Homepage, Club page
- `newsletter_signup` — Sign-up form for a newsletter. Data source: Input from the visitor (name/email) in the form. Makes public: Currently nothing: after submitting, the form only shows a success message without sending or storing the entered data anywhere — no delivery/storage endpoint is connected yet. Fits: Homepage, Club page
- `social_feed` — Tile grid of social-media-style posts. Data source: fixed input in the widget form Makes public: Only what the club administration enters here manually — no real connection to Instagram/Facebook/X, unlike the instagram/facebook widgets. Fits: Homepage, Social media page
- `weather` — Weather display (e.g. for outdoor facilities/sports ground). Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: Homepage, Department page

**werbung**

- `ad_banner` — Advertising banner placeholder at a defined position. Data source: fixed input in the widget form Makes public: nothing beyond what was entered Fits: any page
<!-- /gen:docs widgets -->

## Templates

All eight design templates (`cai.club.05.design`, field `homepage_template`)
with a short description.

<!-- gen:docs vorlagen -->

- `elegance` — Editorial, refined template — plain, modern, elegant.
- `sport` — Bold, dark, athletic template — powerful and energetic.
- `community` — Warm, welcoming, human template.
- `minimal` — Purist, text-focused template — less is more.
- `festlich` — Tradition-conscious, prestigious template for events and anniversaries.
- `modern` — Contemporary template with gradient accents and a wow factor.
- `classic` — Proven, reliable, traditionally structured template — the safe choice.
- `flex` — Generic, fully config-driven template with no hard-coded design — every look comes from configuration, never from new code (a generalisation of the club-specific Motzing template).
<!-- /gen:docs vorlagen -->

## Errors

- `SCOPE_REQUIRED` — the sign-in is missing the write scope needed for design
  or publishing. `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the sign-in is sufficient, but the club role does not
  allow design or publishing. `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — the `tabs` or `design_settings` input does not match
  the schema, for example a missing or wrongly formatted field.
  `comvenio help fehler VALIDATION_FAILED`.
- `OUTCOME_UNKNOWN` — `action confirm` after `cai.homepage.02.apply` ended
  with a timeout or server error; do not retry, check the published state
  with `cai.homepage.03.show` first. `comvenio help fehler OUTCOME_UNKNOWN`.
- `CONFLICT` — the page was already changed between reading and writing;
  read the current state again and decide anew.
  `comvenio help fehler CONFLICT`.
- `USAGE_ERROR` — an old command (for example `homepage slot`,
  `homepage tree`) no longer exists in the CLI.
  `comvenio help fehler USAGE_ERROR`.
