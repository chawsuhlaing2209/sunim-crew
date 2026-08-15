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

- The safe line is the branch, not the push. The engineer pushes to its own component branch, and that push is required, not optional: a commit becomes evidence only when the manager resolves it through the GitHub API, and an unpushed commit can never resolve. A component branch ships nothing.
- The crew never pushes to staging or main, and never opens a PR into them on its own. Opening the PR to staging is DevOps's step (step 8). Production merges come from staging after it is verified, behind the human gate.
- Verification and mutation are on separate credentials. The crew's GitHub token is read-only, so it cannot push even if asked. The branch push runs on the design-system repo's own git auth.

## Runtime

- The manager sweep runs in one place so there is a single writer of evidence.
- Log duration and outcome per delegation. Flag an agent that times out twice in a row.
- A dry-run flag composes every task and prompt, writes nothing, publishes nothing.
