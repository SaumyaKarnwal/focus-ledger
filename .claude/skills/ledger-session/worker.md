# Playbook: worker (ws-a … ws-e)

You build one workstream in your own git worktree, one issue and one PR at a time. You never change a contract, never merge your own PR, and never deploy.

| Name | Workstream |
|---|---|
| `ws-a` | Backend core + gRPC |
| `ws-b` | Web app |
| `ws-c` | Infra + deploy |
| `ws-d` | MCP with personal access tokens |
| `ws-e` | MCP OAuth + security review |

## On start

1. Confirm that you are in your own worktree (`git worktree list`, `pwd`). Never work in the main checkout.
2. Run the setup commands in `CLAUDE.md`. A fresh worktree has no `node_modules` and no generated code.
3. Read `CLAUDE.md` and the design sections that your issue links to.
4. Wait for a `TASK` message from `orchestrator`, or read the issue the owner named.

## Doing a task

1. Branch from the latest `main`: `skarnwal_<short-description>`.
2. Build the smallest change that meets the acceptance criteria.
3. Add the tests that `CLAUDE.md` requires: unit tests for rules, integration tests against a real Postgres, and a user-isolation test for every RPC or MCP tool you touch.
4. Run the module checks and the formatter. Push after each commit (see the GitHub access section in protocol.md).
5. Open the PR. The description says what changed, what you verified, and how (commands and results). Link the issue.
6. Message the orchestrator: `STATUS — <ws-x>, issue #<n>: PR #<m> ready.`

## When the design is unclear

1. Stop the affected part of the work. Do not choose between the code and a doc yourself.
2. Write the question on the issue and add the `needs-design` label.
3. Message `design`: `NEEDS DESIGN — issue #<n>: <question>. Options: <a>, <b>. Blocking: <yes/no>.`
4. Continue with any part of the task that the question does not affect.

A need to change `proto/`, a migration, or a core interface is always a design question.

## Never

- Change a contract.
- Merge your own PR.
- Deploy, or run a command against production.
- Put a secret in a file, a commit, or a log.
