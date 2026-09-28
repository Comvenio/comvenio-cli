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
composes it themselves through the commands described here.

## Requirements and permissions

> **Sign-in:** The commands in this article are classic commands. They run with a device-token
> sign-in (`comvenio login --device-token <token>`). With the browser sign-in alone the CLI reports
> `OAUTH_ONLY`; the same goal is then reached through the enabled actions: `comvenio action list`
> shows them, `comvenio help fehler OAUTH_ONLY` explains the way.

```bash
comvenio login
comvenio whoami --json
comvenio club info --json
```

The club normally comes from the signed-in context. For deliberate work on
another club, `--club <club-id>` is set; identifiers are never guessed, they
are looked up first.

Design and publishing steps (`club design`, `homepage apply`) need the
permission to manage club settings. Without it, Comvenio reports
`PERMISSION_DENIED` — an administrator of the club grants that permission.
If the sign-in is missing the required scope, Comvenio reports
`SCOPE_REQUIRED` with the matching `comvenio login --scopes …` command.

## Workflows

### Tool chain

Every change follows the same order: read the contracts → read the current
state → compose structure and design → generate a preview → run the check →
get approval → apply. No step is skipped, and `homepage apply --clear` never
runs without explicit approval.

### Reading contracts and current state

```bash
comvenio schema homepage --json > homepage-schema.json
comvenio schema design --json > design-schema.json
comvenio homepage show --public --json
```

The homepage schema is authoritative for the available widget kinds and
their config fields, for section layouts and style variants, for the public
detail routes for news and events, for safe button targets, and for the
non-configurable, always identical frame of the page. Unknown fields, widget
kinds or values are never invented — they are looked up in the schema.

### Unchangeable areas of the page

Only the actual homepage content is configured. Independent of the homepage
JSON, every club page always shows:

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
The full structure is written as one file (see Examples). The
`clear_existing` field inside that file is not the approval for a
destructive write — that is controlled exclusively by the deliberate
`--clear` flag when applying.

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
  them in the club area or via `comvenio club contact-requests`. The preview
  does not send anything. An older, purely informational membership form
  does not confirm a successful application and must not be treated as one;
  `contact_form` is the only widget intended for contact and membership
  interest. Rebuilding a form from free-form HTML is not supported. Stored
  requests are permanently removed 30 days after deletion, and at the latest
  365 days after they were received.
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
can the page be edited as a tree of headings, text, images and buttons
without writing HTML.

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
- A slot can be addressed and set individually (details in Examples); an
  existing skeleton can be swapped without recreating the page — existing
  slot content is preserved, and a slot changed in the meantime is never
  overwritten, only reported with exit code `4`. The widget id needed for
  that comes from `comvenio homepage slot get <tab>/<slot> --json` (field
  `widget_id`) or `comvenio homepage tree --json` (second path segment).
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
  in the HTML instead of in slots — stays readable but can only be edited at
  the slot level in the tree. `comvenio homepage tree` states the detected
  format for each tab in one line. It can be converted to the new format with
  `comvenio homepage convert --tab <slug> --out home.json`; any spots left
  open afterward are filled in by hand, checked in the preview, and only then
  applied.
- A skeleton with fixed text or an image outside a slot, without a unique
  slot name, without an area label, with an unknown style, or with more than
  one main heading is rejected when written.

### Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Header and navigation are missing live, the preview still showed them | an older landing mode survived in the design file | write `"landing": false` explicitly into the design file and apply again |
| Dark border or shadow around a cut-out logo | the image widget draws a card by default | explicitly turn off the card style on the image slot (`card_style` field set to `none`) |
| A portrait crest looks cropped in the round header | older version of the display | use the current version; upload the logo square or transparent |
| "No image configured" for only one person | an old state sits in the browser cache | fully reload the page |
| Custom CSS for a width has no effect | the rule targets a class the slot does not carry | inspect the actual structure in the preview and target the right container |
| The check reports a finding only on one event page | contrast issue in an embedded external page | note it separately, don't "fix" it via the homepage design |
| A club body shows many "not filled" | positions in the club aren't assigned | maintain the club data, don't paper over it in the display |

### Preview and checking

```bash
comvenio homepage preview \
  --file home.json \
  --design-file design-settings.json \
  --ttl-hours 24 \
  --open \
  --json

comvenio verify homepage \
  --file home.json \
  --design-file design-settings.json \
  --audit \
  --json
```

The preview is valid for 30 minutes by default; `--ttl-hours` (1–24) sets a
longer, server-limited lifetime, for example for a full-day approval. The
preview never changes the published page.

Without `--file`, the check runs against the club's published address. That
address is derived exclusively from the club's stored subdomain; other
technical identifiers are not a homepage address and are never used as a
fallback. If the subdomain is missing, the CLI points to the club settings
or to the draft check with `--file`.

The check covers every public tab, the separate legal notice page, display
on mobile, tablet, landscape and desktop — concretely at 390, 768, 1024 and
1440 pixels width —, horizontal overflow and empty main
regions, invisible text and contrast, console and network errors, the fixed
legal footer with all its targets, operability of every mandatory link, and
the club's stated responsibility plus at least one public contact detail on
the legal notice page. Text over image, video or gradient surfaces is not
measurable by nature and is therefore never counted as a finding.

Exit codes: `0` fully checked, no fixable findings; `2` check incomplete, for
example due to a technical error during the check; `4` fully checked, but
with a fixable quality or legal-page issue. Screenshots and the report
always come before human approval — an exit code of `0` does not replace
that approval.

### Publishing

Only after explicit approval, and only after backing up the current state —
`--clear` replaces every existing tab, section and widget:

```bash
comvenio homepage show --public --json > backup-home.json
comvenio club info --json > backup-club.json

comvenio club design --file design-settings.json --dry-run --json   # read the warnings
comvenio club design --file design-settings.json --json
comvenio homepage apply --file home.json --clear --json
comvenio homepage show --public --json
comvenio verify homepage --audit --json
```

`club design` merges instead of replacing: a key that is set live and
missing from the file is kept — even though the preview does not show it,
because it only renders the file. The CLI explicitly points out such
retained keys, especially when an old full-screen landing mode survives: the
published page then loses its header and navigation even though the preview
looked correct. For a normal page, `"landing": false` is therefore always
written explicitly into the design file.

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

Basic structure with one tab, one section and one hero widget:

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

Complete design file:

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

Reading and setting one slot:

```bash
comvenio homepage slot get start/hero-titel --json
comvenio homepage slot set start/hero-titel --file entry.json
```

Swapping only the skeleton of an existing widget, slot content is kept:

```bash
comvenio homepage geruest set start --widget <widget-id> --file geruest.html --dry-run
comvenio homepage geruest set start --widget <widget-id> --file geruest.html
```

## Commands and actions

<!-- gen:docs befehle -->

**homepage** — complete

- `comvenio homepage preview`
- `comvenio homepage apply`
- `comvenio homepage show`
- Fields and values: `comvenio schema homepage --json`
<!-- /gen:docs -->

## Errors

- `SCOPE_REQUIRED` — the sign-in is missing the write scope needed for design
  or publishing. `comvenio help fehler SCOPE_REQUIRED`.
- `PERMISSION_DENIED` — the sign-in is sufficient, but the club role does not
  allow design or publishing. `comvenio help fehler PERMISSION_DENIED`.
- `VALIDATION_FAILED` — the structure or design file does not match the
  schema, for example a missing or wrongly formatted field.
  `comvenio help fehler VALIDATION_FAILED`.
- `CONFLICT` — a skeleton or widget was already changed between reading and
  writing; read the current state again and decide anew.
  `comvenio help fehler CONFLICT`.
