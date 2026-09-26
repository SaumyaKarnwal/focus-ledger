---
name: ledger-session
description: Load the Focus Ledger session role (design, orchestrator, or a ws-* worker) and its playbook, including how to message the other sessions. Use at the start of every Claude Code session in this repository, and whenever the session is unsure of its role or how to reach another session.
---

# Focus Ledger session roles

Focus Ledger is built by several Claude Code sessions that work together. This skill tells the current session which role it has, what it does, and how it talks to the others. The full model is in `docs/execution-plan.md`, section "Orchestration".

## Step 1: find your role

1. If the skill was invoked with an argument (`design`, `orchestrator`, or `ws-a` … `ws-e`), that is your role.
2. Otherwise, call `ListAgents`. The first line of the result is this session's own name. Use it as your role.
3. If the name is none of the above, ask the owner which role this session has. Tell the owner to set the name with `/rename <role>`, because other sessions address messages by name.

## Step 2: load your playbook

| Role | Read |
|---|---|
| `design` | [design.md](design.md) |
| `orchestrator` | [orchestrator.md](orchestrator.md) |
| `ws-a` … `ws-e` | [worker.md](worker.md) |

Every role also follows [protocol.md](protocol.md): the message formats, GitHub access, and the rules that no role may break.

## Step 3: confirm

Tell the owner in one line: your role, the playbook you loaded, and your first action.
