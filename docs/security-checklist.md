# Security and hardening checklist

Run before you package, and give a short report.

## Secrets, never in a tracked file

- Keys live in config or a secret store: Anthropic, GitHub (read-only), Airtable, Asana, Chromatic, npm. Never in a tracked file, a doc, a prompt, or a chat.
- Each teammate runs workers with their own key, on their own machine. The crew never stores anyone's secret.
- Workers never receive the publish keys (npm, production deploy). Only the gated deploy step holds those, and only after the human approves.

## The trust model

- No code writes the Development status. Add a CI check that fails the build if any code sets that field.
- Evidence is written only by the manager, and only after it verifies (commit resolves, link 200, test rows real). A worker cannot write an evidence field.
- A human approves before the production deploy and the npm publish. The crew cannot publish on its own.

## Git

- Every component branch opens a PR to staging, never to main. Production merges come from staging after it is verified.
- Do not push or open PRs automatically. Do the work, report it ready, wait to be asked.

## Runtime

- The manager sweep runs in one place so there is a single writer of evidence.
- Log duration and outcome per delegation. Flag an agent that times out twice in a row.
- A dry-run flag composes every task and prompt, writes nothing, publishes nothing.
