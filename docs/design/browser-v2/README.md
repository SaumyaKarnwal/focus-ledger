# Browser app mocks, version 2

These boards replace `docs/design/browser/` for every screen they show. They come from the owner's design canvas, sections "The loop", "States of the same screens", "Making a task", and "Managing them" (1440 × 900). The palette tries lower on the canvas ("Palette", "Warm palette") are not part of the build.

Each file is plain HTML with inline styles. It needs the canvas runtime (`support.js`) to render, but the markup and the styles read directly. The colors in a board are reference values only: the app reads every color from a theme token (see [`../theming.md`](../theming.md)).

## Screens

| Area | Files | What it shows |
|---|---|---|
| Start | `C-Desk-Start`, `-Start-Exec`, `-Start-Shallow`, `-Start-Empty` | The home screen. The whole screen takes the selected mode's color: Deep Focus aubergine, Execution rose, Shallow teal-sage. A stepper sets the length; START and Take a break. The bottom strip shows the task and its time. |
| First run | `C-Desk-Start-Empty`, `C-Desk-Start-Pick-Empty` | There is no separate first-run screen. A new user lands on Start with nothing selected ("What are you working on?"), and the picker shows its empty state. The v1 `FirstRunScreen` (name field, estimate rows, "Start the first cycle") is removed. |
| Task picker | `C-Desk-Start-Pick`, `-Start-Pick-Empty` | A dialog over Start: search, recent tasks with their time, "Not sure yet" (goes to Untagged), and New task. Keys: ↑↓ move, ↵ pick, esc close. The footer shows no key hint line (owner decision); the keys still work. **Order:** tasks with cycles first, by their latest cycle, newest first; then tasks with no cycles, newest created first. A search keeps the same order. |
| Running | `C-Desk-Run` | The clock, a progress bar, PAUSE, and Stop and log. The task is bound, so the strip has no chevron. |
| Bell | `C-Desk-Bell2`, `-Bell2-Empty` | A dialog when the time is up. The cycle is already written. Keep going for N more minutes, Take a break, or Start a new cycle. |
| Break | `C-Desk-Break2`, `-Break2-Long` | Short or long break, in its own winter teal. The user picks one; nothing picks it automatically (owner decision: no "long break every N cycles"). "Coming back to" shows the last mode and task. |
| New task | `C-Desk-NewTask`, `-NewTask-Parent`, `-Parent-Hover`, `-Parent-Add`, `C-Desk-EditTask` | The task dialog: name, parent picked from the tree (add a branch on hover), and the estimate. Edit uses the same dialog. |
| Tasks | `G-Tasks`, `-Hover`, `-Unfiled`, `-Drag`, `-Empty` | The task table in a fixed panel. Untagged cycles at the top. Drag a cycle onto a task to file it; drag a task onto a task to change its parent. |
| Task page | `E-Task`, `E-Task-Edit`, `E-Task-Pie`, `E-Task-Done` | Back arrow (bare arrow, as on `E-Task`), parent path above the name, Mark complete / Completed button, estimate card (editable: minutes × cycles per mode), "How it splits" ring of leaf tasks, and the last seven days. |
| Settings | `H-Settings-Stacked` | Two cards in one 680px column: Cycles (mode lengths, short break, long break; no "long break every N cycles") and The bell (sound, volume, two switches). |

Report is not designed yet. The header shows it, but the link stays inert. The owner ships without Report: when Settings and the other screens are merged, the build may deploy.


## Addresses

Every page has its own address, so a user can type it, bookmark it, reload it, and use Back and Forward (owner request):

| Address | Page |
|---|---|
| `/` | Home (Start; Running or Break when one is active) |
| `/tasks` | Tasks |
| `/tasks/<node id>` | Task page |
| `/settings` | Settings |
| `/report` | Report (the interim page until its board exists) |

- The header links and the wordmark change the address; they do not keep a hidden screen state.
- A wrong or old address goes home. Another user's task ID also goes home: the server answers `NOT_FOUND`.
- Moving between pages never pauses or stops a running cycle (rule 7).
- The backend already returns `index.html` for any path that is not gRPC, `/mcp`, `/oauth/*`, or `/.well-known/*`, so a reload on any address works.

## Rules for the build

1. The boards decide the look and the screen flow. Where a board differs from `prd.md`, the board wins on layout and flow; the data rules in `prd.md`, `schema.md`, and `api.md` still hold.
2. "Untagged" (Tasks page) and "Not sure yet" (picker) are both the PRD's Inbox: a cycle with no node.
3. The ten RPCs in `api.md` cover every action on these boards. No proto change.
   - Drag a cycle onto a task: `UpdateCycle`, which files it.
   - Drag a task onto a task: `UpdateNode`, which changes its parent.
   - Keep going: `UpdateCycle`, which extends it.
   - A drop takes effect at once, with no confirm step, also when the moved task carries cycles. Filing an Untagged cycle is final (a cycle's task is set once), and the drop still does not ask.
4. A break is not stored. It lives only in the browser, like the pause.
5. **Mark complete** (owner rules, #132). The task page button reads **Mark complete** on an open task and **Completed** on a completed one; a press toggles it. Completing and reopening follow `api.md`, "Completing a task": completing a task completes everything under it; reopening a task reopens its parents up to the top, and nothing under it. On the Tasks page a completed task shows only in the muted ink: no "Completed" label. The task picker hides completed tasks.
6. **Settings storage.** The proto stays as it is. The server keeps what `SettingsPb` has; the browser keeps the rest in local storage, per device:

   | Control | Stored in |
   |---|---|
   | Deep Focus, Execution, Shallow minutes | `SettingsPb` mode minutes |
   | Short break | `SettingsPb.break_minutes` |
   | Long break | browser local storage (default 15) |
   | Bell sound Silent or not | `SettingsPb.sound_enabled` |
   | Show a notification when it rings | `SettingsPb.notifications_enabled` |
   | The sound choice, volume, ring when a break ends | browser local storage |
   | Alarm repeat (1–5 rings, default 3) | browser local storage |
   | Focus sound (None, Ticking fast, Ticking slow, White noise, Brown noise; default None) and its volume (default 40%) | browser local storage |

   Two additions that `H-Settings-Stacked` does not show yet. Both reuse the board's own row, stepper, chip, and slider styles:
   - **Repeat:** a stepper row in The bell card, under the sound chips: "Ring" N "times". The bell rings N times, then stops.
   - **Focus sound:** a third card under The bell, titled "Focus sound", with the line "Plays only while a cycle runs." It holds the Sound dropdown (rule 12) and a Volume slider. The sound starts with a cycle, stops on Pause and resumes after it, and stops at the bell, at Stop, and on a break. The browser generates all five sounds with the Web Audio API, so the app ships no audio files.

   Auto start, auto check, themes, and other settings are not in this release.

   The numbers on the boards (60, 45, 30) are sample values. The defaults stay as in `prd.md`.
7. **Navigation while a cycle runs or a break counts down.** The header links work on every screen, Running, Bell, and Break included (owner decision). Leaving the screen does not pause or stop anything: the clock, the focus sound, and the bell keep going.
   - On any other page, the header shows a small chip with the mode mark and the time left, for example "Deep Focus 47:12". The chip and the Ekagra wordmark both go back to the running screen.
   - When the time runs out on another page, the app goes back to the running screen and shows the bell there.
8. **Timer digits and the main button** (owner request, after the Pomofocus look).
   - The timer digits use **Inter Tight 700**, bundled with the app (`@fontsource/inter-tight`; no Google Fonts request, so no user IP goes to Google) (owner's pick, replacing Nunito 800), with tabular figures (`font-variant-numeric: tabular-nums`), so the digits do not jump. The fallback stack is `"Inter Tight", "Inter", system-ui, sans-serif`. This replaces IBM Plex Mono for the big timer only. Small figures (durations, estimates) keep Plex Mono.
   - START, PAUSE, and the break START keep Nunito (bundled), bold, uppercase. No font stack starts with a system font such as "Arial Rounded MT Bold", so every platform shows the same face. The button is a solid plate with a lower ledge: a 6px bottom edge in a darker tint of the plate. On press, the plate moves down 6px and the ledge disappears, so it reads as a physical key. With reduced motion, the press has no movement.
   - The faces are tokens (`--font-timer`, `--font-cta`), and the ledge color is a token (`--screen-cta-ledge`), so a theme can change them.
9. **Small window** (owner request). The layout shrinks in steps, and each step happens only when the content no longer fits. Use container queries on the screen's main area, not fixed window sizes.
   1. **Side by side** (the boards): the mode list on the left, the timer and buttons on the right.
   2. **Stacked:** when the two columns cannot fit side by side at their natural size, the mode list moves above the timer and keeps its rows. The rows may get smaller type.
   3. **Chips:** only when the stacked layout still does not fit the height, the three mode rows become one row of small chips (mode mark and name). While a cycle runs, no mode chip shows at all: the screen color names the mode (owner decision). The timer region keeps the mode name for screen readers only. In the side-by-side step, Running keeps the board's "Focus for this cycle" row. The progress bar under the timer also hides in the stacked and chips steps; the side-by-side step keeps it.

   The other parts at every step:
   - **Header:** when the links no longer fit on one line, they collapse into one menu button (Report, Tasks, Settings, account). The date hides first.
   - **Timer:** the digits scale with the space (`clamp`).
   - **Buttons:** always the two buttons of that screen.
   - **Task line:** one line, cut with an ellipsis. The planned readout and the parent path hide when the line does not fit.
   - **No scroll** on Start, Running, and Break at any step.
   - **One scale, kept in ratio** (owner, after testing). One size variable, from the main area's width and height (the smaller one wins), sizes the timer, the buttons, the chips, and the task line together. At full size the boards' sizes hold (timer 150px, START 72px tall). Below that, everything shrinks by the same factor, so the boards' ratios hold at every size: the timer stays the largest element, and no button keeps a fixed minimum size that would make it larger than that ratio (a 40px floor for touch is allowed). Digit height means the rendered digit box.
   - **What goes away first:** at the chips step, the wordmark hides (the menu button stays). The task line shrinks with the scale; when the area is too short for it, it hides.
   - **The bell dialog scales too:** its width, padding, title, and buttons follow the same size variable, to at most 92% of the area's width. In a small window it is smaller than in the boards, never larger than the screen.
   - **No overlap at any size:** the chips never cover the wordmark, and the buttons never cover the divider or the task line.
10. **Last seven days, hover** (owner request). At rest, the chart shows no figure above the bars; empty days keep their dash. On hover (or keyboard focus, or a tap on touch), the bar under the pointer stays at full color and the other bars fade, as the "How it splits" ring does. A small card, in the same style as the ring's hover card, shows the day, its total, and the split into Deep Focus, Execution, and Shallow with the mode marks. Leaving the bar restores the chart.
11. **Home and Stop** (owner bugs, #132).
    - **Home** is the Start screen. The Ekagra wordmark leads home from every page. If a cycle runs or a break counts down, it leads to that screen instead (rule 7).
    - **Start remembers the last cycle.** Start opens with the task and the mode of the most recent cycle selected, and the clock at that mode's length from Settings. With no cycle yet, Start shows nothing selected and Deep Focus.
    - **Stop and log** writes the cycle and goes home at once, with that cycle's task and mode selected. It does not show the bell. The bell shows only when the time runs out by itself.
    - **The header links work on every Start state** (Deep Focus, Execution, Shallow, nothing selected) and on Break, not only on Deep Focus.
    - **Every button on these screens has a ledge** (rule 8). The primary button (START, PAUSE, the break START) is the solid plate. The secondary button ("Take a break", "Stop and log", "Start a cycle") keeps its outline and gets the same ledge, in a darker tint of the screen color (`--screen-secondary-ledge`), and the same press movement.
12. **Bell sound is a dropdown** (owner request). In The bell card, the Sound row is one dropdown (Bowl, Wood, Chime, Silent) in place of the four chips. The dropdown is only as wide as its longest option plus the chevron (about 120px), not a wide field. There is no separate play button. Clicking an option in the open list plays it once and selects it, the current option included, so the user previews a sound by picking it. Silent plays nothing. A native `<select>` cannot play the current option again, so build a listbox button (ARIA `listbox` pattern: ↑↓ move, ↵ or click pick, esc close) styled with the theme tokens. The Focus sound card uses the same narrow dropdown for its Sound row (None, Ticking fast, Ticking slow, White noise, Brown noise), with the same play-on-pick rule (a pick plays 3 seconds; None plays nothing), in place of its chips.
13. No color literal outside the theme files. See [`../theming.md`](../theming.md).
14. Deploy only after Settings and all screens above are merged. Report is not needed for the first release.
