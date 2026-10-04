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
| Task page | `E-Task`, `E-Task-Edit`, `E-Task-Pie`, `E-Task-Done` | Back arrow (bare arrow, as on `E-Task`), parent path above the name, Mark complete / Completed button, estimate card (editable: minutes × cycles per mode), "How it splits" ring of leaf tasks, and the last seven days. |
| Settings | `H-Settings-Stacked` | Two cards in one 680px column: Cycles (mode lengths, short and long break, long break every N cycles) and The bell (sound, volume, two switches). |

Report is not designed yet. The header shows it, but the link stays inert. The owner ships without Report: when Settings and the other screens are merged, the build may deploy.

## Rules for the build

1. The boards decide the look and the screen flow. Where a board differs from `prd.md`, the board wins on layout and flow; the data rules in `prd.md`, `schema.md`, and `api.md` still hold.
2. "Untagged" (Tasks page) and "Not sure yet" (picker) are both the PRD's Inbox: a cycle with no node.
3. The ten RPCs in `api.md` cover every action on these boards. No proto change.
   - Drag a cycle onto a task: `UpdateCycle`, which files it.
   - Drag a task onto a task: `UpdateNode`, which changes its parent.
   - Keep going: `UpdateCycle`, which extends it.
   - A drop takes effect at once, with no confirm step, also when the moved task carries cycles. Filing an Untagged cycle is final (a cycle's task is set once), and the drop still does not ask.
4. A break is not stored. It lives only in the browser, like the pause.
5. **Mark complete** sets the node's `closed` flag with `UpdateNode`; **Completed** clears it. The Tasks page lists completed tasks (with `include_closed`), with the name in the muted ink. The task picker hides them.
6. **Settings storage.** Every setting lives on the server in `SettingsPb` (owner decision, #112). The browser keeps no setting in local storage.

   | Control | `SettingsPb` field |
   |---|---|
   | Deep Focus, Execution, Shallow | `deep_focus_minutes`, `execution_minutes`, `shallow_minutes` |
   | Break | `break_minutes` |
   | Bell sound chips (Bowl, Wood, Chime) | `bell_sound`; Silent is `sound_enabled = false` |
   | Bell volume, Ring N times | `bell_volume`, `bell_repeat` |
   | Show a notification when it rings | `notifications_enabled` |
   | Ring when a break ends | `ring_after_break` |
   | Focus sound chips, focus volume | `focus_sound`, `focus_sound_volume` |

   **Values a browser already holds.** A browser that ran #98 or #110 may hold settings in local storage. On the first load after #112, the app reads those keys once. For each key, it sends the value in one `UpdateSettings` call with only those mask paths. When the call succeeds, it deletes the keys. After that, the server value always wins. If two devices both hold local values, the later upload wins. The numbers on the boards (60, 45, 30) are sample values; the defaults are the column defaults in `schema.md`.

   Two controls that `H-Settings-Stacked` does not show yet. Both reuse the board's own row, stepper, chip, and slider styles:
   - **Repeat:** a stepper row in The bell card, under the sound chips: "Ring" N "times". The bell rings N times, then stops.
   - **Focus sound:** a third card under The bell, titled "Focus sound", with the line "Plays only while a cycle runs." It holds the five chips (a chip click previews the sound for 3 seconds) and a Volume slider. The sound starts with a cycle, stops on Pause and resumes after it, and stops at the bell, at Stop, and on a break. The browser generates all five sounds with the Web Audio API, so the app ships no audio files.

   Auto start, auto check, themes, and other settings are not in this release.

   The numbers on the boards (60, 45, 30) are sample values. The defaults stay as in `prd.md`.
7. No color literal outside the theme files. See [`../theming.md`](../theming.md).
8. Deploy only after Settings and all screens above are merged. Report is not needed for the first release.
