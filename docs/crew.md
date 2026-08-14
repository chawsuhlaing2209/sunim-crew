# Sunim Crew, the north star

Working name, rename anytime. This is the settled design. When anything feels fuzzy, read this.

## What it is

An installable agentic crew. You drop it into any design system repo, point it at your keys, your Airtable base, and your Asana, and it takes a component from Figma to a published, documented library, with humans at the gate before anything goes public.

## The spine: status is derived, not written

The Airtable Development field is a formula. Nobody sets it. It reads the evidence and computes the stage:

| Evidence present (and verified)            | Derived status    |
| ------------------------------------------ | ----------------- |
| Figma link, nothing built yet              | To-do             |
| Commit resolves                            | To be staged      |
| Staging Storybook link returns 200         | Ready for Testing |
| Test rows, any Failed                      | To be fixed       |
| Test rows, some marked Fixed (To re-test)  | Fixing            |
| Test rows, all marked Fixed (To re-test)   | Fixed             |
| Test rows, all Passed                      | To be deployed    |
| Production URL and Astro link both resolve | Completed         |

So a stage advances only when its real evidence lands. Nobody can drag a card forward.

## The rule that keeps the formula honest

Evidence is verified before it is written. An agent reports its result in its Asana subtask. The manager confirms the commit resolves, the staging link is 200, the test rows are real, then writes the evidence field. A pasted fake link never reaches Airtable, so it never moves the status.

## The roles

- Manager: the orchestrator. Reads Airtable status, creates and assigns Asana tasks, verifies evidence, writes it. Uses no judgment on quality. Runs as a daily routine.
- Engineer: builds the component from the Figma node, previews Storybook, runs vitest and Chromatic, commits. Reports the commit.
- QA: tests every state and prop, writes Passed or Failed rows into Storybook Testing with screenshots. Reports.
- DevOps: deploys staging, then production, publishes to npm. Handles conflicts. Reports links.
- Human: approves before production and publish, and signs off on the docs prose.
- Later lanes: Auditor (read a source, extract tokens and a component list), Advisor (how to ship, what to build next), Reporter (monthly scorecard and skill upgrades).

## The task model (Asana)

One component is one Asana task. Each lifecycle stage is a subtask: Implementation, Stage, Test, Fix, Deploy, Document. The manager creates the task and subtasks, assigns the right agent, and reads completion to drive the next step. Details in `docs/asana.md`.

## How it runs together

- Airtable: shared data and status, the dashboard the team watches.
- Asana: the crew's task list, who does what.
- Git: the component code, branches and PRs.
- Workers: run on each teammate's machine with their own key, no shared state to collide.
- Manager: runs in one place (a daily routine) so there's a single writer of verified evidence.

## The human gate

The crew runs on its own up to production. A person approves before the production deploy and the npm publish, the one irreversible public step. Everything before that is automatic.

## Installable

Ship the repo plus a clonable Airtable base template. Others duplicate the base, add their own keys and Asana in config, and run their own crew. Nothing of yours is hardcoded.
