# Product

## Register

product

## Users

One owner, sometimes with a few trusted people sharing the owner's authority, running their own Shift server on a Linux host. They are developers who automate work on their repositories with AI coding agents (OpenCode on the server). They pair several desktop clients (Windows, macOS, Linux) to that one server and check in from whichever machine they are at.

Their context is intermittent: they design a workflow, start runs, then leave. They come back when something needs them (an approval, a form, a failure, a stuck step) or to see what a run did. Closing the app never stops work on the server.

The job: build durable workflows as graphs of agent, human, timer and routing steps, run them, and step in at the right moment with confidence about what has and has not happened.

## Product Purpose

Shift is a self-hosted control plane for durable workflows. Models do bounded work; Shift owns execution, scheduling, authority, persistence, human interactions and recovery. The desktop app is a remote interface to that server: it authors workflow definitions, starts and controls runs, answers human requests and shows exactly what happened.

The workflow graph canvas is the whole app. Everything else floats over it as anchored islands; there is no dashboard. See [docs/ui-direction.md](docs/ui-direction.md).

Success: the owner can build a workflow on the canvas, run it, leave, and return to a precise, trustworthy picture of its state, answering anything that needs them in a click or two, without ever wondering whether an action was applied twice or not at all.

## Brand Personality

Calm, precise, trustworthy. A control room you leave running.

- **Calm:** quiet until something needs attention. No alarm styling for routine states, no motion for its own sake, no celebratory noise.
- **Precise:** exact about state. A run, an execution, an attempt and a wait are different things and look different. Uncertain states say so plainly ("Checking whether your response was saved").
- **Trustworthy:** nothing pretends. Offline data shows when it was last updated; disabled actions say why.

Voice: plain, specific, short. Verb-plus-object actions. No hype.

Visual lineage, from the owner: n8n and Node-RED for the node graph, Figma and FigJam for the canvas and floating islands, and T3 Code (t3.codes) for neutral surfaces, soft panels and typography.

## Anti-references

- **SaaS dashboards:** metric cards, overview pages, charts as a landing screen, a sidebar of sections.
- **Zapier / Make:** bright brand colors, playful illustrations, marketing-style onboarding.
- **Jenkins and old CI UIs:** dense tables, walls of logs, admin-panel forms.
- **Generic AI apps:** purple gradients, glowing orbs, chat-bubble-first layouts.

## Design Principles

1. **The graph is the truth.** Every state is shown where it happens, on the node or edge it belongs to, not in a separate report screen.
2. **Quiet by default, loud only when it matters.** Attention goes to what needs the owner (a request, a failure, an uncertain command); everything else recedes.
3. **Never blur certainty.** Distinguish done, running, waiting, unknown and offline in words and shapes as well as color. Never show a guess as a fact.
4. **Airy, not sparse.** As much space as possible without hiding features: every action stays reachable from an island or ⌘K.
5. **Everything floats over the work.** Islands are anchored, collapsible and never replace the canvas.

## Accessibility & Inclusion

WCAG 2.2 AA.

- Text contrast of at least 4.5:1 (3:1 for large text and UI component boundaries) in both the dark and light themes.
- Full keyboard use, including adding, selecting, configuring, connecting and deleting nodes without dragging, plus a list representation of nodes and edges beside the canvas (client spec 6.4).
- State is conveyed by text or icon shape as well as color.
- Respect reduced motion, OS zoom and font size, and give every control a screen-reader name. Live updates must not steal focus.
