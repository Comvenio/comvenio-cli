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
comvenio schema homepage --json > homepage-schema.json
comvenio schema design --json > design-schema.json
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
required `clear_existing` field explicitly controls whether existing tabs,
sections and widgets are replaced — it has no silent default and must be
set on every call.

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
  tab and converting it to the new format are not yet available as an
  action — do this in the web app.
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
  --input '{"preview_id":"<preview-id>","viewports":["390x844","1440x900"]}' \
  --json

comvenio action call cai.verify.04.homepage \
  --input '{"operation":"preview","tabs":[{"label":"Home","slug":"start","position":0,"visibility_scope":"public","sections":[]}],"viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
  --json
```

`cai.homepage.01.preview` never changes the published page.

With `"operation":"live"` instead of `"operation":"preview"`,
`cai.verify.04.homepage` instead checks the club's published address —
without `tabs`. That address is derived exclusively from the club's stored
subdomain; other technical identifiers are not a homepage address and are
never used as a fallback.

The check covers every public tab, the separate legal notice page and the
given `viewports` — commonly mobile, tablet, landscape and desktop, for
example 390, 768, 1024 and 1440 pixels width —, plus horizontal overflow and
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
  --input '{"operation":"live","viewports":["390x844","1440x900"],"audit":true,"wait_ms":500}' \
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

- `cai.homepage.01.preview` — preview (read)
- `cai.homepage.02.apply` — apply (change with confirmation)
- `cai.homepage.03.show` — private, public (read)
- `cai.homepage.04.screenshot` — screenshot (read)
- Fields and values: `comvenio schema homepage --json`
<!-- /gen:docs -->

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
- `OAUTH_ONLY` — an old command (for example `homepage slot`,
  `homepage tree`) does not run with the current sign-in.
  `comvenio help fehler OAUTH_ONLY`.
