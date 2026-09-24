# Focus Ledger — Product Requirements

2026-09-24 · Saumya Karnwal

## What this is

Focus Ledger records not only how long you worked and on what, but **what kind of thinking it took**. Every cycle carries a mode — Deep Focus, Execution or Shallow — so the record answers a question a normal timer cannot: how much of my week was hard thinking, and where did it go?

**Who it is for.** One person tracking their own work. Not a team tool, not billing, not client reporting. No approvals, no sharing, no manager view.

**Why it exists.** A Pomodoro timer measures time and forgets it. A time tracker measures time per project, which says where hours went but not what they cost. Focus Ledger adds one field and gets a project × mode cross-tab out of it. That table is the product; everything else exists to make filling it cheap and honest.

Two commitments follow, and every requirement below serves one of them:

1. **Logging must be nearly free.** Each extra question at the moment of work is a reason to stop using the app. Ask the minimum, pre-select sensible answers.
2. **The record must be trustworthy.** A ledger you can quietly rewrite is one that flatters you. Decisions are made before the work, not after.

## The data model

Four objects. Everything in the product is a view onto these.

| Object | Definition | Key fields |
| --- | --- | --- |
| **Node** | A thing you work on. Forms a tree of any depth. A project, an area, a task — the app draws no distinction between them. | id, name, parent (nullable), closed (bool) |
| **Cycle** | One recorded stretch of work. The only object that holds time. Immutable once written. | id, node (nullable), mode, started_at, minutes |
| **Mode** | The kind of thinking. Exactly three, fixed, not user-editable in v1. | Deep Focus, Execution, Shallow |
| **Estimate** | A guess at what a node will take, expressed per mode as length × count. Belongs to a node. | node, mode, minutes, cycles |

**Node.** Any node can hold cycles, at any depth, including one that has children. A node with `parent = null` is a root. There is no separate "project" type.

**Cycle.** `node` is nullable — a cycle with no node is unfiled and appears in the Inbox. `mode` is never null. A cycle started by the timer and a cycle typed in by hand produce identical rows; there is no flag distinguishing them.

**Estimate.** Stored per mode, so a node's estimate is up to three rows: `Deep Focus 90 × 2`, `Execution 50 × 6`, `Shallow 25 × 0`. A node with no estimate rows is un-estimated, which is a valid permanent state.

**Mode defaults.** Deep Focus 90 min, Execution 50 min, Shallow 25 min. These are the starting lengths, adjustable per cycle and changeable as defaults in Settings.

## Invariants

Rules that hold everywhere. A violation anywhere is a bug, not a variation.

**I-1 — The log is append-only.** A cycle, once written, is never edited. Not its mode, not its node, not its duration, not its time. A cycle may be **deleted**; it may not be amended. Deleting leaves a ledger that was never silently rewritten.

**I-2 — Mode and node are bound before the clock starts.** Neither can be chosen or changed after. If the work turns out to be something else, you stop the cycle and start another — two honest rows rather than one edited row.

**I-3 — An entry is an entry.** A hand-typed cycle is indistinguishable from a timed one, in the data and in every view. No marker, no second tier, no "estimated" flag.

**I-4 — Roll-up is own plus descendants.** For any node:

```latex
total(n) = own(n) + \sum_{c \in children(n)} total(c)
```

This applies to logged cycles and to estimates alike. An estimate on a node covers **only cycles logged directly to that node**, never its children's work — which is what stops a parent's estimate double-counting the subtree beneath it.

**I-5 — Changing an estimate never touches a logged cycle.** Estimates are forward-looking guesses. Revising one changes what is remaining, never what happened.

**I-6 — Unfiled time belongs to no project.** Inbox is a filter over cycles with `node = null`, not a node. It contributes to no estimate and no roll-up.

**I-7 — Nothing starts itself.** Every cycle begins from an explicit Start with a mode selected. The app never pre-loads or auto-starts the next cycle.

**I-8 — Works without an account.** Full function on local storage from first load. An account adds persistence and sync, never features.

## FR-1 — First run

The first screen must get a stranger to a running cycle without an account, a tutorial or a decision they cannot make.

**Requirements**

1. A single centred column: a name field, the three mode rows, a summary line, and one primary button.
2. The name field asks *What are you working on?* and is **optional**. Left blank, the first cycle is unfiled.
3. Three mode rows, each carrying name, one-line description, and `[− length +] min × [− count +]` with a subtotal.
4. Execution is pre-selected at `50 × 1`. The other two show `× 0` and a dash for their subtotal.
5. A summary line totals the estimate as `N cycles · Xh Ym`.
6. The primary button reads **Start the first cycle**.
7. A Sign in link sits in the header and is never a gate.

**Acceptance criteria**

- Loading the app with no stored data shows this screen and nothing else — no modal, no tour, no account wall.
- Pressing Start immediately, with nothing touched, begins a 50-minute Execution cycle on an unfiled node.
- Typing a name and pressing Start creates that node at the root and begins the cycle on it.
- Adjusting any stepper updates that row's subtotal and the summary line in the same frame.
- Setting all three counts to 0 leaves Start enabled; the cycle runs with no estimate recorded.
- Time from first paint to a running cycle is under 10 seconds for a user who changes nothing.

## FR-2 — Starting a cycle

Every cycle in the app starts the same way, from Today. This is the only path.

**Requirements**

1. Starting requires a **mode**; it does not require a **name**. One mode is always pre-selected, so the requirement can never block.
2. A node must be resolved at Start — either a selected node or `null` (Inbox). It cannot be deferred.
3. Length is adjustable at Start via a stepper, defaulting to the selected mode's default.
4. Mode and node are written into the cycle at Start and are immutable thereafter (I-2).
5. A meta line states what will happen: the end time, and the node's position against its estimate.

**Acceptance criteria**

- Start is never disabled for want of a mode; a mode is always selected.
- Start is never disabled for want of a name.
- The cycle records the mode shown as selected at the moment Start was pressed.
- Changing the length stepper changes the stated end time immediately.
- Starting from the Break screen routes to Today, not into a cycle (I-7).
- No screen in the app can begin a cycle without passing through a mode selection.

## FR-3 — While a cycle runs

This screen is not looked at. It carries the minimum and offers two controls.

**Requirements**

1. Shows: breadcrumb, node name, mode chip, countdown, progress bar, `N of M min`, end time, and one line placing the cycle against the estimate.
2. Exactly two controls: **Pause** and **Stop and log X min**.
3. **No extend.** The length cannot be increased while the clock runs (see FR-4).
4. **No mode change.** The mode chip is text, not a control (I-2).
5. Closing the tab does not lose the cycle; it resumes on reopen.
6. A pause that runs past 10 minutes auto-stops and logs the minutes accrued.

**Acceptance criteria**

- There is no control on this screen that changes the cycle's length.
- There is no control on this screen that changes the cycle's mode or node.
- Stop writes a cycle of the minutes actually elapsed, rounded down to the minute, and routes to the bell.
- Stopping under 1 minute writes no cycle and returns to Today.
- Reloading the browser mid-cycle restores the countdown to the correct remaining time.
- A cycle paused for 10 minutes is closed automatically with the elapsed minutes logged.

## FR-4 — The bell

The cycle is already written before the bell is shown. The bell reports and offers what happens next — it never asks a question whose answer was given at Start.

**Requirements**

1. The cycle is committed to the log **before** the dialog appears. Dismissing, closing or ignoring the bell never loses it.
2. Shows: mode chip with `· logged`, and the node name as the heading.
3. **No tagging question.** The mode was chosen at Start; the bell does not re-ask it (I-2).
4. **No snooze or remind-later.** The bell rings once.
5. Extension lives here and only here: a typed field reading *Keep going for — more minutes*, with no preset value.
6. An extension is added to the existing cycle, not logged as a second one.
7. Two actions: **Take a break** and **Start a new cycle**. The latter routes to Today.

**Acceptance criteria**

- Killing the browser at the instant the bell fires still leaves the cycle in the log.
- No control on the bell changes the cycle's mode.
- The extend field is empty on open; no minute value is pre-filled.
- Extending by 15 on a 50-minute cycle yields **one** logged cycle of 65 minutes, not two.
- Start a new cycle lands on Today with a mode selection required, never on a running timer.
- There is no control that defers the bell.

## FR-5 — The break

A countdown and nothing else. Breaks are not part of the ledger.

**Requirements**

1. Shows the countdown, a progress bar and `N of M min`. Default 5 minutes.
2. Two controls: **+5 min** and **Skip and start**.
3. **Skip and start routes to Today**, never into a cycle — there is no "next cycle" until one is chosen (I-7).
4. No up-next preview, no queued cycle, no long-break counter.
5. Breaks are not written to the log and appear in no report.

**Acceptance criteria**

- No break time appears in any total, chart or export.
- Skip and start lands on Today with a mode selection required.
- Letting the break run out lands on Today, with the same requirement.
- Nothing on this screen names or pre-selects what you will do next.

## FR-6 — Estimates

One control, appearing in three places, behaving identically in all of them: first run, the node panel when adding a node, and Today's edit state.

**Requirements**

1. The control is three rows, one per mode: colour bar, name, `[− length +] min × [− count +]`, and a subtotal. A summary line totals `N cycles · Xh Ym`.
2. An estimate covers **only cycles logged directly to that node** (I-4). Any node may carry one, including a parent with children.
3. At rest, a node's estimate is displayed as progress, not steppers: pips plus `done of estimated · length`.
4. Going past an estimate is allowed and shown, never blocked — a divider and an over-count after the estimated pips.
5. While the estimate is being edited, **Start is held**: dimmed, non-interactive, `aria-hidden`, with a padlock line saying why. Save or Cancel restores it.
6. Editing an estimate never alters a logged cycle (I-5).
7. A parent row displays the rolled-up figure, with its direct figure available on the node itself.

**Acceptance criteria**

- The same component renders in all three places with no visual or behavioural difference.
- A node with 3 direct cycles and children totalling 18 displays 21 rolled up.
- A parent estimated at 5 with children estimated at 35 displays 40 rolled up, never 35 or 5.
- Start cannot be activated by mouse, keyboard or screen reader while the estimate is in edit.
- Cancelling an edit leaves the estimate byte-identical to before.
- Reducing an estimate below the number already logged is permitted; the row shows the overage.
- No layout shift occurs when entering or leaving the edit state.

## FR-7 — The tree

The tree is storage. Today is the start surface. The tree is where structure is built and changed, not where work begins.

**Requirements**

1. An outliner of any depth. Columns: name, `done / est`, time. Parent rows show rolled-up figures.
2. Nodes are created inline by typing. Keyboard: `Enter` sibling, `Tab` indent, `⇧Tab` outdent, `Esc` cancel, `⌘↵` save and start.
3. A node can be **moved** to any other parent, by drag or by a **Move to…** picker. The picker is required; drag alone is insufficient at depth.
4. **Cycles travel with the node.** A cycle belongs to a node, not to a path. Every ancestor on both sides recomputes.
5. Re-attribution is **retroactive**: past reports reflect the new position. Cycles do not remember the path they were logged under.
6. A move carrying logged cycles states what moves: *‘39 cycles · 28h 10m will move with it.’*
7. A node can be **closed**. Closed nodes leave Today's list and the default tree view; they keep every cycle and still appear in reports.
8. A node cannot be moved into its own descendant.

**Acceptance criteria**

- Moving a node with 39 cycles leaves the global total unchanged.
- After a move, the old parent's roll-up drops by exactly the subtree's total and the new parent's rises by the same.
- A report for a past week, re-run after a move, attributes those hours to the new parent.
- Attempting to move a node into its own child is refused with a reason.
- Closing a node removes it from Today's rail without changing any historical figure.
- A closed node can be reopened and returns to the rail.
- A whole project can be typed out without touching the mouse.

## FR-8 — Entries and logging by hand

Work done away from the timer must be recordable, and the result must be an ordinary entry (I-3).

**Requirements**

1. Entry points: **+ Add an entry** in Today's *Logged today* header, and the same action on a node in the Tree.
2. Both open the same **dialog**, titled with the node — not with the action. The page behind is unchanged.
3. The dialog collects: node, mode (the same three-row control), **date**, start time, length. Nothing else.
4. Date defaults to today and is editable, so past work can be logged to the day it happened.
5. On save the entry is written to the date given, and every affected figure recomputes: node counters, roll-ups, that day's list, that week's report.
6. An entry saved to a past date does **not** appear in *Logged today*; it appears in that date's list.
7. Entries may be **deleted**, never edited (I-1). A mistake is removed and re-entered.
8. One entry has one start time. Ranges spanning days are entered as separate entries.

**Acceptance criteria**

- A hand-logged entry is byte-identical in shape to a timer-logged one; no field distinguishes them.
- Logging 50 min to last Friday changes last week's report and leaves today's totals untouched.
- The dialog's heading is the node name, never "Add an entry".
- Cancelling writes nothing and restores the page exactly.
- No entry in the log offers an edit affordance; every one offers delete.
- Deleting an entry reverses its effect on every roll-up and report.

## FR-9 — Inbox

Inbox is a filter over cycles with no node, not a node (I-6). It exists so that naming is never a precondition for logging.

**Requirements**

1. Appears as a row in Today's rail with a count of unfiled cycles.
2. Contributes to **no** estimate and **no** roll-up.
3. Opening it lists the unfiled cycles, each with a **File to…** node picker.
4. Filing a cycle sets its node and updates every affected figure. This is the one field on a written cycle that may be set later, because it was never answered.
5. **No badge, no nag, no zero-inbox prompt.** Unfiled is a permanent valid state.

**Acceptance criteria**

- Unfiled cycles appear in daily and weekly totals but in no project total.
- Filing a cycle to a node increases that node's count by one and the Inbox count by minus one.
- No notification, badge colour or prompt urges the user to empty the Inbox.
- Cycles can remain unfiled indefinitely with no degradation of any other feature.

## FR-10 — Today

The start surface. Three columns: the ongoing list, the selected node, the day and week at a glance.

**Requirements**

1. The left rail lists **all open nodes**, sorted by **most recently worked first**, each with name, path, `done of est`, a relative timestamp, and pips coloured by mode.
2. The timestamp is printed on every row so the ordering is legible rather than arbitrary.
3. Closed nodes do not appear. A footer states the rule and links to the Tree.
4. The centre column shows the selected node: breadcrumb, name, its estimate as progress, the length stepper, Start, a meta line, and *Logged today*.
5. A link pulls a node in from the Tree.
6. The right column shows today's total and mode split, the week's total and mode split, and a link to the report.

**Acceptance criteria**

- Finishing a cycle moves that node to the top of the rail.
- Every rail row displays a relative time, and the ordering matches those times descending.
- Closing a node removes it from the rail within the same session, with no figure changing.
- Selecting a rail row updates the centre column without a page navigation.
- The rail renders correctly with 1 node and with 50.

## FR-11 — Report

The reason the app exists. Everything else is data entry for this screen.

**Requirements**

1. The primary view is a **project × mode cross-tab**: nodes down, the three modes across, hours in the cells, totals on both margins.
2. Rows roll up (I-4) and can be expanded to children.
3. A period selector: this week, last week, this month, custom range. Default this week.
4. A second view compares **estimate against actual** per node: estimated cycles, logged cycles, the difference.
5. Nothing here is editable. The report is a reading surface.
6. CSV export of raw cycles, free, with no account.

**Acceptance criteria**

- Cell values summed across a row equal that node's rolled-up total for the period.
- Column totals summed equal the period's grand total.
- Unfiled cycles appear in mode columns and the grand total, and in no node row.
- A node moved in the Tree reports under its new parent for all past periods.
- Export contains one line per cycle with node path, mode, start time and minutes.
- Export is reachable without signing in.

## FR-12 — Settings, storage and account

**Requirements**

1. Settings holds: the three mode default lengths, break length, sound and notification preferences. Nothing else in v1.
2. Every number in the app is a default that can be changed once and stays changed.
3. The app runs fully on browser local storage from first load, with no account (I-8).
4. An account adds cross-device persistence and sync. It unlocks **no** features, and export stays free either way.
5. The account prompt is a save-prompt, shown in context, stating what already exists locally and what clearing the browser would cost. It is never a wall.
6. Signing in **merges** local cycles into the account rather than replacing them.

**Acceptance criteria**

- A new user can run cycles, build a tree, estimate, and read a report without an account.
- Changing a mode's default length changes what the next Start proposes, and no logged cycle.
- Signing in with 12 local cycles and an account holding 40 yields 52.
- No screen blocks progress pending sign-in.
- Deleting an account deletes its data.

## Out of scope, and what is still open

**Not in v1**

- Teams, sharing, multi-user anything
- Billing, invoicing, hourly rates
- Calendar, task-manager or issue-tracker integrations
- Custom or user-defined modes — three, fixed
- Goals, streaks, gamification, nudges
- Mobile apps — browser only, desktop-first
- Idle detection, screenshots, automatic activity capture
- Entry ranges spanning more than one day

**Open decisions**

| # | Question | Options | Leaning |
| --- | --- | --- | --- |
| 1 | Can a parent node carry its own estimate? | Yes, covering only direct cycles · No, leaves only | Yes — lets you size a project before breaking it down |
| 2 | Are entries delete-only, or editable within a window? | Delete-only · Editable for N minutes | Delete-only — keeps I-1 intact |
| 3 | Does the extend field on the bell take focus automatically? | Yes · No | No — a stray keypress into a text box on an interrupting screen |
| 4 | What is the sample project called across the artboards? | Harbour · something else | Harbour — applied to Today, Running, Bell so far |

**Still to design**

Tree node detail and the Move to… picker, the Inbox filing list, Report, Settings, and the account prompt. First run, Today, the estimate editor, Running, the Bell, the Break and the entry dialog are settled.
