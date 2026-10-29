<!-- SEED: re-run $impeccable document once there's code to capture the actual tokens and components. -->
---
name: Shift
description: A calm control room for durable agent workflows, built on one graph canvas.
---

# Design System: Shift

## 1. Overview

**Creative North Star: "The Quiet Control Room"**

Shift is a room you leave running. The workflow graph fills the window edge to edge, and every other surface floats over it as an anchored, collapsible island, the way Figma's panels float over its canvas. The canvas is neutral and still; nodes read like n8n's cards; the chrome borrows T3 Code's neutral surfaces, soft panels and clean type. Nothing competes with the graph until something needs the owner, and then exactly that thing speaks.

Density sits between compact and roomy: as airy as possible without dropping features. Motion is responsive, not choreographed: islands open and close, node status changes, feedback confirms an action, and nothing performs for its own sake. Both a dark and a light theme exist and follow the OS.

This system rejects, by name, the anti-references in PRODUCT.md: SaaS dashboards (metric cards, overview pages, charts as a landing screen, a sidebar of sections), the Zapier / Make look (bright brand colors, playful illustrations, marketing-style onboarding), Jenkins and old CI UIs (dense tables, walls of logs, admin-panel forms), and generic AI apps (purple gradients, glowing orbs, chat-bubble-first layouts).

**Key Characteristics:**

- One canvas, edge to edge, in a frameless window; islands float over it and never replace it.
- Tinted neutral surfaces with a single signal-green accent.
- State shown on the node it belongs to, in words and shapes as well as color.
- One sans family for all UI, one mono for IDs, code and transcripts.
- Responsive motion only; every movement has a reduced-motion alternative.

## 2. Colors

A restrained palette: tinted neutrals for every surface, one signal-green accent, and a small, separate set of status colors that only ever mean state.

### Primary

- **Signal Green** ([to be resolved during implementation]): the one accent. Primary actions (Run, Publish), the current selection, focus rings and the live connection chip. Never decoration.

### Neutral

- **Canvas, island surface, raised surface, ink, muted ink, hairline** ([to be resolved during implementation]): a tinted neutral ramp, chroma toward the accent's hue, never a warm cream or beige. Dark and light themes each get their own ramp.

### Named Rules

**The One Signal Rule.** Signal Green covers at most 10% of any screen. If two unrelated things on screen are green, one of them is wrong.

**The Status Is Not Brand Rule.** Status colors (running, waiting, needs attention, failed, completed, unknown) are a separate set, used only for state. They never style chrome, and the accent never stands in for a status. Every status color is paired with an icon shape and a word.

## 3. Typography

**Body Font:** [single technical sans to be chosen at implementation]
**Label/Mono Font:** [mono to be chosen at implementation]

**Character:** one quiet, technical sans carries every label, title and form, with hierarchy made by weight and size rather than extra families. The mono appears only where exactness matters: IDs, cursors, code, file paths and agent transcripts.

### Named Rules

**The Mono Means Literal Rule.** Monospace marks text that is literal, machine-meaningful or copyable. Never use it for decoration or "techy" flavor.

## 4. Elevation

Flat by default. The canvas is the floor; islands sit one step above it with a tonal surface and a hairline edge, and modals (the near-full-screen Settings, the centered Inbox) sit one step above islands. Depth comes from tonal layering first; any shadow is small and defined, never a wide soft glow.

### Named Rules

**The Two Steps Rule.** There are only two layers above the canvas: islands, then modals. Nothing nests a third.

## 5. Components

[No components exist yet. They are documented on the first scan-mode run after prompt 12 builds the canvas, the location island, the toolbar and the inspector.]

## 6. Do's and Don'ts

### Do:

- **Do** keep the canvas visible behind every island; the graph is the truth.
- **Do** pair every status color with an icon shape and a word, so state survives color blindness and grayscale.
- **Do** say uncertainty plainly ("Checking whether your response was saved"), and show when offline data was last updated.
- **Do** hold WCAG 2.2 AA contrast (4.5:1 text, 3:1 large text and component boundaries) in both themes.
- **Do** give every movement a `prefers-reduced-motion` alternative.

### Don't:

- **Don't** build a SaaS dashboard: no metric cards, overview pages, charts as a landing screen, or sidebar of sections.
- **Don't** take on the Zapier / Make look: no bright brand colors, playful illustrations or marketing-style onboarding.
- **Don't** fall back to Jenkins and old CI UIs: no dense tables, walls of logs or admin-panel forms.
- **Don't** look like a generic AI app: no purple gradients, glowing orbs or chat-bubble-first layouts.
- **Don't** use a cream, sand or beige surface; neutrals are tinted toward the accent hue or not at all.
- **Don't** pair a 1px border with a wide soft shadow on islands or nodes, and don't round cards or islands beyond 12-16px.
- **Don't** use Signal Green for anything that is not an action, a selection, focus or the live state.
