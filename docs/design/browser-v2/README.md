# Browser app mocks, version 2

These boards replace `docs/design/browser/` for every screen they show. They come from the owner's design canvas, sections "The loop", "States of the same screens", "Making a task", and "Managing them" (1440 × 900). The palette tries lower on the canvas ("Palette", "Warm palette") are not part of the build.

Each file is plain HTML with inline styles. It needs the canvas runtime (`support.js`) to render, but the markup and the styles read directly. The colors in a board are reference values only: the app reads every color from a theme token (see [`../theming.md`](../theming.md)).

## Screens

| Area | Files | What it shows |
|---|---|---|
| Start | `C-Desk-Start`, `-Start-Exec`, `-Start-Shallow`, `-Start-Empty` | The home screen. The whole screen takes the selected mode's color: Deep Focus aubergine, Execution rose, Shallow teal-sage. A stepper sets the length; START and Take a break. The bottom strip shows the task and its time. |
| Task picker | `C-Desk-Start-Pick`, `-Start-Pick-Empty` | A dialog over Start: search, recent tasks with their time, "Not sure yet" (goes to Untagged), and New task. Keys: ↑↓ move, ↵ pick, esc close. |
| Running | `C-Desk-Run` | The clock, a progress bar, PAUSE, and Stop and log. The task is bound, so the strip has no chevron. |
| Bell | `C-Desk-Bell2`, `-Bell2-Empty` | A dialog when the time is up. The cycle is already written. Keep going for N more minutes, Take a break, or Start a new cycle. |
| Break | `C-Desk-Break2`, `-Break2-Long` | Short or long break, in its own winter teal. "Coming back to" shows the last mode and task. |
| New task | `C-Desk-NewTask`, `-NewTask-Parent`, `-Parent-Hover`, `-Parent-Add`, `C-Desk-EditTask` | The task dialog: name, parent picked from the tree (add a branch on hover), and the estimate. Edit uses the same dialog. |
| Tasks | `G-Tasks`, `-Hover`, `-Unfiled`, `-Drag`, `-Empty` | The task table in a fixed panel. Untagged cycles at the top. Drag a cycle onto a task to file it; drag a task onto a task to change its parent. |
| Task page | `E-Task`, `E-Task-Edit`, `E-Task-Pie` | Estimate card (editable: minutes × cycles per mode), "How it splits" ring of leaf tasks, and the last seven days. |

Report and Settings are not designed yet. The header shows them, but they stay out of this build: the links are inert until their boards exist.

## Rules for the build

1. The boards decide the look and the screen flow. Where a board differs from `prd.md`, the board wins on layout and flow; the data rules in `prd.md`, `schema.md`, and `api.md` still hold.
2. "Untagged" (Tasks page) and "Not sure yet" (picker) are both the PRD's Inbox: a cycle with no node.
3. The ten RPCs in `api.md` cover every action on these boards. No proto change.
   - Drag a cycle onto a task: `UpdateCycle`, which files it.
   - Drag a task onto a task: `UpdateNode`, which changes its parent.
   - Keep going: `UpdateCycle`, which extends it.
4. A break is not stored. It lives only in the browser, like the pause.
5. No color literal outside the theme files. See [`../theming.md`](../theming.md).
6. Do not deploy this build. The owner deploys after Report and Settings exist.
