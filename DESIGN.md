# THE DOCKET — implemented design

## Overview

A calm, document-like notebook for contributors shaping job ideas and discussing completed work. The layout gives reading the largest space: a narrow idea list beside an open idea, restrained controls, long-form text, thin separators, and one green accent. The setup screen uses the same structure without fabricated messages. Source: `src/App.tsx`, `src/style.css`, `index.html`.

The wordmark's two offset lines suggest a sheet of paper. There are no illustrative images, charts, gradients, skeleton animations or decorative dashboards. “Job ideas”, “idea”, “new idea” and “comment” are the interface vocabulary. The mandated footer is reproduced verbatim.

## Colors

Canonical hex primitives and semantic aliases are in `src/style.css:1`. Components consume the semantic tokens.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page | `--bg` | `#f7f7f2` | `#141713` |
| Secondary surface | `--surface` | `#eeefe8` | `#1b1f19` |
| Structural separator | `--line` | `#d6d9cf` | `#30372c` |
| Primary text | `--text` | `#242821` | `#e7eae2` |
| Secondary text | `--muted` | `#62685c` | `#a2ad99` |
| Primary action / focus | `--accent`, `--focus` | `#326247` | `#a7d39a` |
| Text on primary action | `--accent-text` | `#f7f7f2` | `#141713` |
| Selected idea | `--selected` | `#e9f0e5` | `#243220` |
| Control boundary | `--control-border` | `#858d7c` | `#6c7962` |

A single accent identifies the primary action, selected idea edge and keyboard focus. Active filter tabs use neutral inversion. Error states use explicit text and dashed invalid-input borders, without relying on another color. Muted text never uses the separator token. Disabled controls are visibly unavailable with 0.55 opacity and explanatory copy; no contrast compliance is claimed for disabled controls.

A synchronous head script selects the persisted `docket-theme` preference, or the operating-system preference, before the application loads. CSS responds only to `html[data-theme]`. The header toggle switches immediately, with no color transition. Storage denial falls back to the system preference without preventing rendering. Actual rendered contrast pairs and their measurements are recorded in `artifacts/validation.md`.

## Typography

IBM Plex Mono is the same family and normal 400/500/600 weights found in the inspected explorer.imd.fun stylesheet. Latin WOFF2 files are bundled in `public/fonts/` and copied to the export. The browser reported all three faces loaded. No external font service is used. Fallbacks: `ui-monospace`, `SFMono-Regular`, `Consolas`, `monospace`; unavailable writing-system glyphs use local fallbacks. No italic face is requested and synthetic faces are disabled.

The compact UI root is 14px with line height 1.6. Actual roles:

- Masthead: 2.7rem (37.8px), weight 500, line height 1.25, tracking −0.07em. It becomes 2.2rem under 780px and 1.9rem under 420px.
- Open idea: 1.85rem (25.9px), weight 500, line height 1.45; 1.7rem on tablet/mobile, 1.5rem below 420px.
- Body: 1.143rem (~16px), weight 400, line height 1.85, at most 67ch, preserved line breaks and `overflow-wrap:anywhere`.
- Idea-list title: 1.02rem (~14.3px), weight 500, line height 1.6. The excerpt is approximately 12px and clamps at two lines; opening the idea exposes its full content.
- Labels, counters, metadata and badges: generally 0.86rem (~12px); counters use tabular numbers. Inputs are at least 16px on mobile to avoid iOS focus zoom.
- Eyebrows: 0.86rem, weight 500, uppercase via CSS, tracking 0.08em. The wordmark uses weight 600.

Headings balance their lines. Long bodies collapse after eight visible lines and offer an explicit “read full text” button. Content is selectable, text-only and escaped by React. Dynamic author values use `bdi`; bodies use `dir="auto"`. Full addresses remain available in author title text and the connected-wallet dialog.

## Layout

`.site-shell` caps the page at 1440px. Desktop gutters are 48px, then 30px below 1100px, 22px below 780px and 16px below 420px. The header is at least 96px tall; masthead padding is 48px above and 44px below. Grouped controls use roughly 8–12px gaps, sections 24–40px.

`.board-grid` uses `minmax(330px,41%) minmax(0,1fr)` on large screens and a 42% list with 310px minimum below 1100px. The list has a structural inline divider; the reading pane has a 40px leading gutter, reduced to 28px. Its content stays at a readable measure, rather than stretching across every remaining pixel.

At 780px the grid becomes one column. The home view shows the list; an explicit idea or new-idea route shows its reading pane with a “← job ideas” control. The unconfigured home stacks its explanation below the list controls. Under 420px the header navigation moves to a second row and the theme control becomes an accessible icon button. Composer actions stack at narrow widths. Subject fields wrap, metadata and badges wrap, and deployment settings become one column. Long URLs and IDs break within their containers.

Observed desktop/mobile layouts and reflow widths: 1440, 800, 780, 390 and 320 CSS pixels, both themes. Native 200% browser zoom and physical devices were not tested. The interface is English; no translated or complete RTL locale review is claimed.

## Elevation & Depth

The site is intentionally flat. Thin borders communicate list divisions, controls and selected/focus states; surfaces distinguish gas notices and compiler input. The only general elevation is the native wallet dialog: a 5px radius, a `0 20px 80px #0005` shadow, and `#0008` backdrop. The mark has an offset line treatment. No content card uses an elevation shadow.

## Shapes

Buttons/fields have 3px radii, chips and compact badges 2px, the dialog 5px. Primary actions share the same geometry as neutral buttons. State markers are small circles paired with status text. The selected row uses a 2px leading accent border. Invalid fields have a 2px dashed boundary. Focus uses a 2px solid outline with 4px offset; forced-colors mode switches it to the system Highlight color.

## Components

All application patterns below are implemented in `src/App.tsx`; transport and state code is separated into `reader.ts`, `wallet.tsx`, `badges.ts` and `model.ts`.

| Pattern | Use and states |
| --- | --- |
| Header | Native navigation links, persisted theme toggle, wallet trigger. One main landmark and a first-focusable skip link. |
| Idea list | Filters use `aria-pressed`; native sort select; each row has a genuine anchor, metadata, subject, vote and comment link. Empty/loading/error states provide next steps. |
| `Meta` / `Author` | Date, optional muted “on mainnet”, truncated address or ENS, seat/IMD/staked badges. Balance errors expose a retry. No chain badges in headers/titles. |
| `Body` | Escaped plain text, preserved line breaks, long-text disclosure using `aria-expanded`. No autolinks, embeds or HTML parsing. |
| `Subject` / `SubjectCard` | Explorer chip plus related-ideas hash route. Optional read-only live facts; plain-link fallback on errors. |
| `Vote` | All-vote count and holder-vote count, pending/confirmed/failed inline feedback. Native disabled state for gate, duplicate and unavailable conditions; required gas switch appears inline. |
| `Composer` | Visible labels, byte counters, exact UTF-8 validation, focus to first invalid field, field-specific errors. Gate and cost explanations precede fields. Confirmation preserves text on failure and refreshes the idea on success. |
| `Gate` / `NetworkNotice` | Brief explanation and actionable connection/balance/network controls. Reading remains open. |
| `Deployment` | Gas/network explanation, deployment action, exact receipt fields, verification settings, compiler JSON disclosure/download and configuration instructions. |
| Wallet dialog | Native modal focus containment and Escape behavior; focus returns to the trigger. Injected providers and optional locally generated WalletConnect QR. |

Filled accent is reserved for the main action in the current task: “new idea” on the board, “publish idea” in the composer, “deploy Docket” on setup. The new-idea navigation becomes neutral when its composer is open. Form submission and transaction feedback use stable status regions. Controls use native semantics, no positive tabindex, and desktop 40px targets where density allows; compact chips/counters use smaller independent targets, with mobile vote/filter controls increased to 40–44px.

Motion is limited to an instantaneous 0.96 pressed-state scale, enabled only when `prefers-reduced-motion: no-preference`. There is no entrance animation, autoplay or smooth-scrolling dependency.

## Do's and Don'ts

- Reuse semantic color tokens and the loaded mono weights; keep content at a readable measure.
- Keep network names in setup/error states or gas explanations. The muted mainnet metadata explains reply cost, never a proposed job's target network.
- Preserve plain-text rendering and runtime configuration. Do not put deployed addresses or private credentials into compiled UI code.
- Use existing native buttons, selects and links. Keep invalid fields labeled and recoverable, and preserve a visible keyboard path.
- For another required page, place it in the existing hash router, keep the header/main/footer, use the existing reading-pane or deployment-page widths, and test both themes and the 780/420px adaptations. Do not add a new accent, font, overlay system or unrequested product feature.
