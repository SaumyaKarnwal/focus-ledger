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
| Report | `R-Report-Today`, `-Week`, `-Month`, `-Range` | One page per range (Today, Week, Month), same order every time. A sans title with the dates under it; ‹ › step one range, and › fades out at now. The two nearest steps have names (Today/Yesterday, This week/Last week, This month/Last month); older ones show their dates. One total beside the title with the change against the range before, in small green or red. Cards: When you focus (minutes per hour, one soft curve per mode; Today uses real minutes, Week and Month use averages), Kind of focus (mode bars), Where it went (ring of top-level tasks, Untagged included), What you set vs what you do (average cycle against the setting), Cycles you finished (one mark per cycle: filled = ran to the bell, outlined = stopped early), a third small card for the week, and Your year (always the last twelve months; no streak: the owner removed "N days in a row · best N"). |
| Sign in | `A-Signin-OnePoint`, `signin-pastel.jpg` | The playful sign-in: the pastel image fills the screen; a frosted card on the left holds एकाग्र, Ekagra, "one-pointed attention", one line, and Continue with Google. Use Google's own sign-in button (Google Identity Services, pill shape), not the drawn "G". The "keep going without an account" link is **not** built: v1 requires an account, and a guest mode is a later decision. |
| Account menu | `A-Account-Menu` | The round initial in the header opens a small menu: name, email, Sign out. Nothing else. |
| Sign out | `A-Signout` | Asks once: "Sign out?" with the board's text, Cancel and Sign out. |

Report is designed (`R-Report-*`). The palette tries (`P-Palettes`) are not part of the build; they are candidates for future themes.


## Report rules

1. **When you focus** spreads each cycle over the clock hours it spans (a 9:40 to 10:30 cycle gives 20 min to 9:00 and 30 min to 10:00). Week and Month show the average per day over every day of the range up to today, empty days included.
2. **The change beside the total** compares like with like: a range that is still running ("so far") is compared with the same elapsed part of the range before (this week Monday to Tuesday against last week Monday to Tuesday).
3. **Custom** stays: a start and an end date, the same cards for that span, and ‹ › step by the span's own length. Your year ignores it, as it ignores every range.
4. **What you set, what you do** uses the cycles themselves: "set" is the average planned length of the range's cycles per mode, and "do" is their average actual length. It needs no settings history.

## Report and task page polish (owner, after the first deploy)

1. **Estimate card with no estimate:** each mode's bar shows that mode's share of the task's logged time (Execution 44h 08m of 44h 14m fills almost the whole bar). With an estimate, the bar shows logged against that mode's estimate, as before. A bar never stays empty while its mode has logged time.
2. **What you set, what you do:** the "set" tick uses a quiet grey (`--ink-muted`), not black. No "| set" key at the card's top right; the "set 21m · avg 17m" line under each mode says it.
3. **Cycles you finished:** no "bell / stopped" key at the card's top right. When a mode has more cycles than fit in two rows, its marks become one bar split into finished and stopped, as the board's Month note says.
4. **Your year:** no streak line ("1 days in a row · best 17"); the owner removed it. Hovering a day (or focusing it with the keyboard, or tapping it) shows a small card with the date and that day's total focus, for example "Tue 22 Sep · 3h 40m". An empty day says "No focus".

5. **Every bar chart shows its figures on hover only** (Your week, Week by week, This week so far, Last seven days, and any later one). At rest, no figure sits above a bar. On hover, focus, or tap, that bar stays full and the others fade, and a small card shows the label and the value, as rule 10 says for the task page.

## Paused and the parent picker (owner, round 3)

1. **No status labels on the timer screens.** Running, Paused, Bell, and Break show no status words under or near the timer ("Paused", "Running", "Extended", "+5 min added", and the like). The buttons carry the state: RESUME means paused. The screens hold only what the boards show: the timer, the buttons, the chips, and the task line.
2. **In the parent picker, Enter adds and never selects.** This replaces the earlier rule that showed a new branch "in the tree as picked".
   - Enter in the add field adds the branch to the tree, clears the field, and keeps it open for the next name. A new branch can go under any existing or new branch.
   - Selecting the parent is a separate action: a click on a row, or ↑↓ to a row and Enter on that row (not in the add field).
   - Esc leaves the add field and keeps the added branches.
   - **Top-level branches** (owner, round 3): typing is the way to create one. The picker has the same shape as the Start task picker: the matching rows scroll above a hairline, and below it sit two pinned rows, as "Not sure yet" sits there: **None** (the task has no parent) and, while no row has exactly the typed name (ignoring case), **Create "<text>"** ("Create" muted, no "+"). The pinned rows never scroll away. Enter in the search picks the highlighted row, which is the first match; when nothing matches, the create row is the only row, so Enter creates. Creating adds the branch at the top level, clears the search, and gives the new row focus without selecting it; a second Enter or a click selects it. Adding inside a row is only the hover + on that row. An empty tree shows "None" and a grey hint, "Type a name to create one". "None" stays: it makes the task itself a top-level task.
   - Nothing is written until Create (or Save): then every new branch is created, parents first, each with its own `request_id`, and the task goes under the selected row. Cancel creates nothing. A retry after a failure reuses the same `request_id`s.

## Report range arrows stay put (owner, round 3)

The ‹ › pair sits at the left of the range title, before it, with a 16px gap. The title, total, and change follow it and may change width freely: nothing to their left moves, so the arrows never jump and no empty gap opens. (A fixed-width slot after the title left a wide gap for short titles such as "31 Aug – 6 Sep · 0m".) The figures use tabular digits.

## Colors on light screens

On every light screen (Report, the task page, the Tasks page, Settings, the dialogs) a mode mark uses the soft tint from the New task dialog: Deep Focus lilac `#C9A3C4`, Execution rose `#E9AFB4`, Shallow teal `#A6CFCB`. This is a value change of the `--mode-*-mark` tokens in the default theme only; no component changes. The timer screens keep their deep backgrounds. Task rings use soft tints too (`--chart-*`); a slice may share a hue with a mode, because the ring always has its own legend.

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
   - The timer digits use **Nunito 700** (owner raised it from 600), bundled with the app (`@fontsource/nunito`), owner's pick after Inter Tight 700 looked too heavy. Nunito's digits all have the same width (checked in the font file), so the timer does not jump while it counts. Quicksand was rejected for that reason: its digits have different widths and it has no tabular figures. The stack is `"Nunito", system-ui, sans-serif`. Small figures (durations, estimates) keep Plex Mono.
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
   - **What goes away first:** at the chips step, the wordmark and the task line ("Working on" / "What are you working on?") hide; the menu button stays. The task line shrinks with the scale before that.
   - **The timer has a floor:** the digits never go below 64px. When the area is too small for a 64px timer plus the buttons, the remaining extras hide (chips, then the − and + steppers), never the timer.
   - **The bell dialog scales too:** its width, padding, title, and buttons follow the same size variable, to at most 92% of the area's width. In a small window it is smaller than in the boards, never larger than the screen.
   - **No overlap at any size:** the chips never cover the wordmark, and the buttons never cover the divider or the task line.
10. **Last seven days, hover** (owner request). At rest, the chart shows no figure above the bars; empty days keep their dash. On hover (or keyboard focus, or a tap on touch), the bar under the pointer stays at full color and the other bars fade, as the "How it splits" ring does. A small card, in the same style as the ring's hover card, shows the day, its total, and the split into Deep Focus, Execution, and Shallow with the mode marks. Leaving the bar restores the chart.
11. **Home and Stop** (owner bugs, #132).
    - **Home** is the Start screen. The Ekagra wordmark leads home from every page. If a cycle runs or a break counts down, it leads to that screen instead (rule 7).
    - **Start remembers the last cycle.** Start opens with the task and the mode of the most recent cycle selected, and the clock at that mode's length from Settings. With no cycle yet, Start shows nothing selected and Deep Focus.
    - **Stop and log** writes the cycle and goes home at once, with that cycle's task and mode selected. It does not show the bell. The bell shows only when the time runs out by itself.
    - **The header links work on every Start state** (Deep Focus, Execution, Shallow, nothing selected) and on Break, not only on Deep Focus.
    - **Every button on these screens has a ledge** (rule 8). The primary button (START, PAUSE, the break START) is the solid plate. The secondary button ("Take a break", "Stop and log", "Start a cycle") keeps its outline and gets the same ledge, in a darker tint of the screen color (`--screen-secondary-ledge`), and the same press movement. **The two buttons look the same size** (owner, #225): the outlined button is drawn slightly larger (234 × 75 against the solid plate's 230 × 72 at full size), because an outline reads smaller than a filled plate. Both share one centre line and the same 6px ledge. At the 40px floor in a small window, both have the same height and the outline is only wider. Only the fill and the label weight tell primary from secondary.
12. **Bell sound is a dropdown** (owner request). In The bell card, the Sound row is one dropdown (Bowl, Wood, Chime, Silent) in place of the four chips. The dropdown is only as wide as its longest option plus the chevron (about 120px), not a wide field. There is no separate play button. Clicking an option in the open list plays it once and selects it, the current option included, so the user previews a sound by picking it. Silent plays nothing. A native `<select>` cannot play the current option again, so build a listbox button (ARIA `listbox` pattern: ↑↓ move, ↵ or click pick, esc close) styled with the theme tokens. The Focus sound card uses the same narrow dropdown for its Sound row (None, Ticking fast, Ticking slow, White noise, Brown noise), with the same play-on-pick rule (a pick plays 3 seconds; None plays nothing), in place of its chips.
13. No color literal outside the theme files. See [`../theming.md`](../theming.md).
14. Deploy only after Settings and all screens above are merged. Report is not needed for the first release.
