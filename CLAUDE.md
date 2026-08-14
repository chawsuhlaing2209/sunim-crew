# CLAUDE.md — Sunim Crew (project law)

Read this before any step. Stack facts are in `tools.md`. Roles and the pipeline are in `docs/crew.md`. Build one step at a time, name the files you'll touch, wait for the go.

## What this is

An installable agentic crew that ships design system components. Airtable holds the data and the status. Asana holds the crew's tasks. Claude Code runs the workers. Git holds the code. npm publishes the library. Astro holds the docs.

## The one idea everything protects

Nobody writes the status. The Development field is a formula in Airtable, derived from evidence: a commit that resolves, a staging link that returns 200, test rows that exist, a production URL, a docs page. A stage advances only when its real evidence lands. So no agent and no human can move a component by editing status.

## Hard rules

- No one writes the Development status. It is a formula. Never add a step that sets it directly.
- Evidence is verified before it is written. An agent reports its result in its Asana subtask. The manager confirms the commit resolves, the link returns 200, the test rows are real, then writes the evidence field. Never write evidence an agent only claimed.
- The manager checks process, never quality. Every check is a yes or no.
- Workers get no status access. They read their Asana subtask and the design source, do the craft, and report. They produce one artifact, nothing more.
- A human approves before production and before npm publish. Nothing reaches the public without that sign-off.
- Nothing specific to a design system is hardcoded. Keys, the Airtable base, the repo, Figma, Asana, all come from config.
- Documentation quality is a human call at the end. The manager only checks the docs page exists and has every section.
- No em dash, no design system jargon, in any prose or docs.

## When I ask for a feature

Name the files you'll touch before touching them. Wait for my go. Build the step, then stop.

## Never

- Set the status field from code or from a worker.
- Write an evidence field the manager has not verified.
- Give a worker the publish keys, or write scope beyond its one artifact.
- Publish to npm or deploy to production without the human gate.
- Hardcode a base id, a repo, or a key.
