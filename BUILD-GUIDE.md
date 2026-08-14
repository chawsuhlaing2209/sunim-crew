# Build guide — Sunim Crew in Claude Code

An installable agentic crew that takes a component from Figma to a published, documented design system. Status lives in Airtable as a formula, tasks live in Asana, code lives in git. Each step is one prompt you paste into Claude Code. Build one step, read the diff, run it, commit, then move on.

The north star is `docs/crew.md`. The spine that never bends: nobody writes the status, the manager only writes evidence it has verified, and a human approves before anything goes public.

---

## Before you start

- Node 20+, Claude Code signed in.
- The Airtable base duplicated into your account. Base id and token in config. Field ids are in `tools.md`.
- An Asana workspace and token in config.
- A GitHub repo for the design system, and a read-only GitHub token.
- An Anthropic API key. Steps that spawn workers spend it.
- Figma MCP, Chromatic, and an npm account for publishing, all in config.

Everything is bring-your-own and config-driven. Nothing of yours is baked into the code.

---

## The steps

| Step | Builds |
|---|---|
| 1 | Scaffold and config |
| 2 | Airtable client and the status read model |
| 3 | The verify layer |
| 4 | Asana client and the task model |
| 5 | The runner and worker briefs |
| 6 | The manager routine and the liar test |
| 7 | Engineer lane, build to To be staged |
| 8 | DevOps stage lane, to Ready for Testing |
| 9 | QA lane, to To be deployed or To be fixed |
| 10 | Fix loop |
| 11 | Human gate, production, npm publish |
| 12 | Docs, to Completed |
| 13 | Installable packaging |
| 14 | Hardening and the daily schedule |

Later lanes, after the core runs end to end: Auditor, Advisor, Reporter (`docs/crew.md`).

---

## Step 1 — Scaffold and config
```
Read CLAUDE.md and tools.md first, including the Config surface section. Set up a TypeScript Node project called sunim-crew: Node 20+, strict, ESM. Install zod and the Airtable and Asana clients. Dev deps: vitest, prettier, eslint, husky, lint-staged with the Prettier settings in tools.md. Build one config surface, validated with zod, that holds everything project-specific from tools.md: the Airtable base id and token plus the table and field NAME map, the Asana token, workspace, and project id, the Figma token, the target repo path or url and its branch names, and the keys. Nothing project-specific is hardcoded. Ship a config example file with keys and names only, no secrets, and a .gitignore that covers the real config. No application logic yet. Explain the structure, then stop.
```
Done when: the project installs and config loads from the environment with nothing hardcoded.

## Step 2 — Airtable client and the status read model
```
Read tools.md, the Config surface section. Build src/airtable: a thin typed client that addresses every table and field by the NAME in config, never by a hardcoded id. On startup it reads the base schema, resolves each expected name to that base's id, and throws a clear error listing any name the base is missing, so a duplicated base works with only its base id and token changed. The client can read a component row and its derived Development status, list components by status, write the evidence fields (Commit, Storybook, Staging URL, Production URL, Astro Link), and read and write Storybook Testing rows. It must never write the Development or Synchronization fields, those are formulas, add a guard that throws if a write targets one. Explain, then stop.
```
Done when: you can list components by status and write one evidence field, and writing a formula field throws.

## Step 3 — The verify layer
```
Build src/verify: pure functions, no model calls. commitResolves(url, token) GETs the commit and checks 200. linkLives(url) checks 200. testRowsReal(componentId) confirms the Storybook Testing rows exist and each has an attachment. docsPageComplete(url) fetches the Astro page and checks every required section from docs/component-contract.md is present. tokenClean(sourcePath) finds no raw hex. contractValid(path) validates the contract file. Each returns {ok, evidence}. These gate every evidence write: the manager calls them before writing. Explain, then stop.
```
Done when: each check returns a clear ok plus evidence on a real and a fake input.

## Step 4 — Asana client and the task model
```
Read docs/asana.md. Build src/asana: create a component task, create the lifecycle subtasks (Implementation, Stage, Test, Fix, Deploy, Document), assign a subtask to an agent, read whether a subtask is done, and read the result the agent wrote into it. One component maps to one task, keyed by the component name and the Airtable row link. Explain, then stop.
```
Done when: you can create a component task with its subtasks and read a subtask's state.

## Step 5 — The runner and worker briefs
```
Read tools.md. Build src/runner: delegate(opts) spawns Claude Code headless, one process per delegation. Read the current headless flags from the docs, do not guess. Write the composed prompt to disk before spawning. Stream stdout to a log. Hard timeout, kill the tree on timeout. The child gets no Airtable status access and no publish keys.

Add src/briefs/{engineer,qa,devops}.md. Each describes one craft and how to report its result back into its Asana subtask. No status talk, no writing evidence, no reading another component. Explain, then stop.
```
Done when: a trivial brief returns a log and exit 0, and no worker path can write status or hold a publish key.

## Step 6 — The manager routine and the liar test
```
Read docs/crew.md and docs/asana.md. Build src/manager: sweep() reads every component whose derived status needs the next action, ensures the right Asana subtask exists and is assigned, and when a subtask reports done, verifies the reported evidence with src/verify and only then writes the evidence field to Airtable. Runs once and stops, no polling loop.

sweep.test.ts, the liar test: stub a worker that marks its subtask done and reports a commit URL that does not resolve. Assert the manager does not write the Commit field, the status stays put, and the component is flagged. Explain, then stop.
```
Done when: the liar test passes. A claim with no real evidence never moves the status.

## Step 7 — Engineer lane, build to To be staged
```
Read docs/crew.md and src/briefs/engineer.md. Wire the Implementation subtask. The engineer reads the Figma node from the Design column via the Figma MCP (get_design_context, get_variable_defs), builds the component into the design system repo on a branch, previews Storybook locally, runs vitest and Chromatic, commits, pushes, and reports the commit URL into its subtask. The manager verifies the commit resolves, writes Commit to Airtable. The formula moves the component to To be staged. Explain, then stop.
```
Done when: a To-do component with a Figma link is built, committed, and lands at To be staged with a real commit.

## Step 8 — DevOps stage lane, to Ready for Testing
```
Read docs/crew.md and src/briefs/devops.md. Wire the Stage subtask. DevOps opens a PR to staging, deploys staging, and reports the staging Storybook link. It resolves any conflict, and if the failure is the component's fault it reports back so the manager creates a Fix subtask for the engineer. The manager verifies the staging link returns 200, writes Storybook. The formula moves the component to Ready for Testing. Explain, then stop.
```
Done when: a To be staged component is deployed to staging and lands at Ready for Testing with a live link.

## Step 9 — QA lane, to To be deployed or To be fixed
```
Read docs/crew.md and src/briefs/qa.md. Wire the Test subtask. QA tests every variant, size, and state against the staging Storybook, and writes one Storybook Testing row per case with a Passed or Failed result and a screenshot. The manager verifies the rows are real with attachments. The formula reads them: all Passed moves to To be deployed, any Failed moves to To be fixed. Explain, then stop.
```
Done when: a tested component with all rows Passed reaches To be deployed, and one Failed row sends it to To be fixed.

## Step 10 — Fix loop
```
Read docs/crew.md. On To be fixed, the manager creates one Fix subtask per failed row, each carrying only the case name, the expected result, and the suggestion. The engineer applies the fix and marks that row Fixed (To re-test). The formula shows Fixing while some remain and Fixed when all are marked. The manager then reassigns the Test subtask to QA, who retests and writes Passed or Failed. When all pass, the formula reaches To be deployed. Keep verbatim in the fix brief: apply the suggestion, do not re-diagnose. Explain, then stop.
```
Done when: a failed component is fixed, retested, and reaches To be deployed.

## Step 11 — Human gate, production, npm publish
```
Read docs/security-checklist.md. Add the human gate: a component at To be deployed waits for a person to approve, through a signed-in command or the Asana Deploy subtask marked approved by a named approver. Only then does DevOps deploy production and publish the library to npm. DevOps reports the production URL and the npm link. The manager verifies both resolve and writes Production URL. No publish key ever reaches a worker, only this gated step holds it. Explain, then stop.
```
Done when: nothing publishes without the human approval, and an approved component deploys and publishes.

## Step 12 — Docs, to Completed
```
Read docs/component-contract.md. On production, the manager creates the Document subtask and writes the component's Astro Starlight page with every required section. It verifies the page resolves and holds all sections, then writes Astro Link. With Production URL and Astro Link both present, the formula reads Completed. Prose quality is signed off by a human. Explain, then stop.
```
Done when: a deployed component gets its docs page and reaches Completed.

## Step 13 — Installable packaging
```
Read docs/crew.md and docs/security-checklist.md. Make the repo installable by anyone. Confirm every value is config, not code. Write a README and a setup script from clone to first sweep. Ship the clonable Airtable base template, schema only. Add a license, a contributing guide, and a security note. Confirm a fresh clone with fresh config runs a sweep against a fresh base. Explain, then stop.
```
Done when: someone who is not you clones the repo, duplicates the base, adds config, and runs a component to Ready for Testing.

## Step 14 — Hardening and the daily schedule
```
Read docs/security-checklist.md. Add the CI check that fails if any code writes the Development field. Add a --dry-run flag that composes tasks and prompts but writes and publishes nothing. Log duration and outcome per delegation, flag repeated timeouts. Schedule the manager sweep as a daily routine in one place, so there is a single writer of evidence. Short report, then stop.
```
Done when: with a dry run, a full sweep plans every step and touches nothing, and the CI check catches a status write.

---

## Habits that keep this safe
- After every step: name the files, read the diff, run it, commit.
- Nobody writes the status. The manager writes only evidence it verified. A human approves before anything public.
- Workers report into their Asana subtask. They never touch status or hold a publish key.
- Nothing of yours is hardcoded. Every specific value lives in config.
- After each step, log it to `docs/diary/` for your case study and lessons.
