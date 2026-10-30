# Desktop UI direction

Agreed with the owner on 2026-10-28. This replaces the layout in [Shift Client v0](shift-client-v0.md) section 5, which proposed a project sidebar inspired by T3 Code. Section 5's resources, behaviour and safety rules still apply; this document only changes how they are arranged on screen. Prompts 12 and 13 build from it.

## Principle

The workflow graph canvas is the app. Everything else is an island floating over it. There is no dashboard, overview page or list screen.

- The window is frameless and the canvas runs edge to edge.
- Islands are anchored to edges and corners, as in Figma. They can be collapsed but not dragged freely.
- Every action can be reached from an island, and ⌘K (Ctrl+K elsewhere) is the fast path to all of them.

The only full-screen step is first-launch pairing. The canvas appears once a server is paired.

## Canvas

One canvas, two modes:

- **Draft.** The workflow's draft is edited directly on the canvas.
- **Run.** Opening a run shows that run's frozen graph, from the version it started on, with live status on each node. It is read-only.

Nodes are n8n-style cards. A card shows the type icon, a title, one line of key configuration and named ports on its edges. In run mode it also has a status ring. A node that ran more than once in a loop gets a count badge (×3) showing the latest pass's state. The inspector picks a specific pass.

Nodes are added from the toolbar's "+" or by dragging out of a port onto empty canvas. Either way, a node picker island opens. Validation problems are marked on the nodes they belong to.

## Always on screen

- **Location island** (top left): Project / Workflow / Run ▾. While a draft has unpublished changes, it shows a "Draft · unpublished changes" badge.
- **Connection status chip.**
- **Attention count.**
- **Canvas toolbar:** add node, zoom and fit, undo and redo, ▶ Run, and Publish.

## Islands

| Island | Where | What it holds |
| --- | --- | --- |
| Switcher | Opens from the location island | Projects on the left, the selected project's workflows on the right. Searchable, with create for both. "Workspaces" in conversation means projects. |
| Runs | The "Run ▾" part of the location island | The workflow's runs, newest first, with Draft always first. |
| Run status | Top centre, in run mode | State, why the run is waiting, active time, and only the actions that apply right now. |
| Inspector | Tall, right edge | The selected node's configuration, output, errors, attempts and loop passes. A running agent's live transcript is a tab here. |
| Sessions | Left edge, collapsible | The project's agent sessions, each linked to the runs that used it. |
| Node picker | Next to the toolbar "+" or the dragged port | Node types to add. |
| Run input | Centre | The trigger's input form, when a start needs input. |
| Attention toast | Corner | A new attention item. Clicking it opens the run, selects the node and opens its form. |
| Inbox | Large, centred | Every open attention item. |
| Banner | Top, slim | Connection problems, with one action. |
| Hint | Centre of an empty canvas | Add a project or create a workflow. |
| Settings | Nearly full-screen modal | Connection, Devices, Appearance, and later sections from client spec 5.1. |

## Flows

- **Starting a run:** ▶ on the trigger node or in the toolbar. If the trigger needs input, the run input island appears. The canvas then switches to the new run.
- **Publishing:** Publish in the toolbar. The server validates, and problems are shown on the nodes.
- **Disconnects:** the status chip turns amber when offline and red when revoked or incompatible. The banner offers a single action: retry, pair again or update. The canvas keeps showing cached data, read-only, with when it was last updated. Nothing is queued for later.

## Look

- References: n8n and Node-RED for nodes and graphs, Figma and FigJam for the canvas and islands.
- Borrowed from T3 Code: neutral dark surfaces, with colour kept for state; soft rounded panels with subtle borders and light shadows; its clean sans-serif UI type, with monospace for IDs and code.
- Dark and light themes follow the OS, with an override in Settings.
- Density sits between compact and roomy: as airy as possible without dropping features.

## ⌘K palette

Agreed with the owner on 2026-10-29: actions first. With an empty query it lists open attention items, then the actions that apply to what is on screen (Run, Cancel, Publish, Settings, Inbox, theme), then recent workflows and runs. Typing searches workflows, runs, nodes in the open graph, projects and actions together.

## Still open

- Exact colours, type sizes and spacing. These are settled while building prompt 12.
