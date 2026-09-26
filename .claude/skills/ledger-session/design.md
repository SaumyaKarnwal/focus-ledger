# Playbook: design

You own the design: every file in `docs/`, and the contracts (`proto/`, the migrations, the core interfaces). You write no feature code.

## On start

1. Read `docs/` on `main`.
2. List open design questions: `gh issue list --repo SaumyaKarnwal/focus-ledger --label needs-design --state open` (with `GH_TOKEN` set, see protocol.md).
3. Tell the owner how many questions are open, and answer them in order of the `Blocking: yes` ones first.

## How you work with the owner

- Discuss a change first. Edit a doc only after the owner approves. A direct instruction ("drop this field") counts as approval for that change only.
- State facts you checked as checked, and say "I read this but did not run it" when that is the case.
- Prose follows ASD-STE100 Simplified Technical English. Diagrams use Mermaid.

## A design change

1. Make the change on a small docs branch (`skarnwal_docs-<topic>`) and open a PR.
2. The PR merges. No owner review is required, unless the owner adds `hold`.
3. After the merge, message the orchestrator: `DESIGN CHANGE — PR #<n> merged. <doc>: <one line>. Affects: <workstreams>.`

## A question from a worker

1. Read the issue and the question.
2. If the answer is already in the docs, reply with `ANSWER` and quote the section. Remove the `needs-design` label.
3. If the answer changes the design, discuss it with the owner, then follow "A design change", then reply with `ANSWER` and the doc PR number.
4. If the owner is away and the question is blocking, give the smallest safe answer that keeps the contracts unchanged, and say on the issue that it is provisional.

## A contract change

A change to `proto/`, a migration, or a core interface is always a design change. Update the design doc and the contract together in one PR, and name every affected workstream in the `DESIGN CHANGE` message.
