# Stackfolio Design System

## Product

Stackfolio is a private, single-owner financial operating surface for tracking recurring digital services, one-time hardware/career investments, memberships, ledger entries, and twelve-month subscription movement. The app is not a marketing dashboard: it is the working ledger itself.

Primary jobs:

- Understand total, annual, and latest monthly spend at a glance.
- Find, filter, sort, and update any tracked cost quickly.
- Inspect a cost's membership, status, monthly distribution, metadata, and ledger history.
- Add a new cost or a new ledger entry without leaving the context.
- Compare active recurring services across a rolling twelve-month period.

## Existing information architecture

- Persistent shell: Stackfolio identity, Overview, Costs, Table View, sign out, Add cost.
- Overview: analysis year, four portfolio metrics, monthly trend, lifetime allocation, annual trend, top costs.
- Costs: search, two quick filters, expandable advanced filters, sortable ledger, membership inline edit, cost detail drawer.
- Table View: active recurring subscriptions as a wide monthly matrix with sticky service and total columns.
- Global create flow: responsive Add cost modal.

## Visual language to preserve

- English UI copy.
- Private-first, analytical, calm, and personal rather than consumer-fintech promotional.
- Inter/system sans typography; strong numeric hierarchy; tabular financial data.
- Deep navy navigation shell, white/very-light-blue working canvas, sky blue primary accent.
- Secondary category accents: yellow, periwinkle, and purple.
- Lucide outline icons with consistent 1.5-2px visual weight.
- Thin neutral rules, restrained shadows, 10-17px radii, compact data rows.

## Current tokens

- Canvas: `#f5f7fb`; panel: `#ffffff`; ink: `#111827`; muted: `#64748b`; line: `#dfe6ef`.
- Navigation: `#08101f` and `#111c32`.
- Primary accent: `#38bdf8`; dark accent: `#0284c7`.
- Category accents: `#f4c95d`, `#8aa8ff`, `#db91ff`.
- Danger: `#b64f4f`.
- Shadow: `0 14px 42px rgba(15, 23, 42, 0.08)`.
- Breakpoints: 1180px, 860px, 620px, 350px.

## Redesign constraints

- Preserve all existing information, real actions, and data density.
- Keep the recognizable dark Stackfolio shell and exact English labels.
- Improve desktop canvas use: the work surface should feel deliberate on wide screens without creating a sparse marketing layout.
- Improve scan hierarchy: emphasize the current year's operating cost and trajectory, while keeping lifetime spend available.
- Reduce nested-card repetition; use stronger rails, table/list anatomy, and selective framing.
- Keep charts readable with high-contrast axes and tooltips.
- Make mobile navigation and primary actions thumb-safe; keep content clear above the bottom bar.
- Replace ambiguous horizontal clipping with visible scroll affordance, paging, or a purpose-built compact mobile representation.
- Keep tables as tables on desktop. Do not convert data-heavy desktop surfaces into generic card grids.
- Preserve semantic headings, native form labels, status announcements, focus visibility, reduced-motion behavior, and 44px mobile targets.

## Motion

- Use 120-180ms transitions for hover, focus, selection, and surface changes.
- Avoid decorative page-load animation.
- Respect `prefers-reduced-motion`.
