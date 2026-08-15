# tools.md — Sunim Crew (stack facts)

Facts only. Rules live in CLAUDE.md.

## Project
Sunim Crew. An installable agentic crew that takes a component from Figma to a published, documented design system, tracked on Airtable and orchestrated through Asana.

## Stack
| Layer | Pick |
|---|---|
| Language | TypeScript strict, ESM |
| Runner | Claude Code headless, one process per delegation, on the operator's own sign-in |
| Validation | zod |
| Tests | vitest (unit), Chromatic (visual), Storybook (states) |
| Registry | npm, the published component library |
| Docs | Astro Starlight |
| Schedule | a daily routine for the manager sweep |

Node 20+. Prettier: semi true, singleQuote true, trailingComma all, printWidth 80, tabWidth 2.

## Source of truth and dashboard
An Airtable base holds the data and the status. Set its id as `baseId` in config. The Development field is a formula, never write it. The crew writes evidence fields, and the formula reacts.

Components table `Components`:
- Figma, Design
- Commit
- Storybook, the staging link, Staging URL
- Production URL, Astro Link
- Development, a formula, and Synchronization %
- Total Tests, Passed Tests, Testing Results Summary

Test rows table `Storybook Testing`: Testing Results (Passed, Failed, Fixed (To re-test)), linked to Components.

The crew never hardcodes an id. It addresses Airtable by name from config (below) and resolves those names to the base's own ids at startup, so a duplicated base needs only its id and token changed. The one-time formula setup does need your base's own field ids, which Airtable lists in the API reference for your base.

The derived-status logic is in `docs/crew.md`.

## External surfaces
- Claude Code, headless workers. Read the current flags from the docs, do not guess.
- Asana, the crew's task manager. Component task plus lifecycle subtasks. Token from config.
- GitHub, branches and PRs. Read-only token to confirm a commit resolves.
- Figma MCP, get_design_context and get_variable_defs.
- Chromatic, visual tests. npm, publish. Astro, docs.

## Config surface, everything project-specific
One config, read from the environment or a config file. Nothing below is hardcoded, so the same crew runs on any project.

```
airtable:
  baseId              # a duplicated base gets a new id, set yours
  token
  tables:             # names, kept when a base is duplicated
    components: "Components"
    tests: "Storybook Testing"
  fields:             # logical key -> the field name in your base
    figma: "Figma"
    design: "Design"
    commit: "Commit"
    storybook: "Storybook"
    stagingUrl: "Staging URL"
    productionUrl: "Production URL"
    astro: "Astro Link"
    development: "Development"       # formula, derived, never written
    synchronization: "Synchronization %"
    totalTests: "Total Tests"
    passedTests: "Passed Tests"
    testResults: "Testing Results"
    componentLink: "Composed in"     # the link from a test row back to its component
asana:
  token
  workspaceId
  projectId           # the board the crew creates component tasks in
  agents:             # who plays each role, an Asana user gid or a known email
    engineer          # a role left blank opens its subtask unassigned
    qa
    devops
    manager
figma:
  token               # the per-component node URL comes from the Airtable row
  fileKey             # the design system's Figma file
repo:
  pathOrUrl           # the design system repo the crew builds into
  stagingBranch
  mainBranch
  slug                # owner/repo, used to confirm a commit resolves
npm:
  registry            # defaults to the public npm registry
worker:
  auth                # subscription, the default, or api-key
  model               # what every worker runs as. The CLI default when unset.
  maxMinutes          # a ceiling on any delegation. Lowers a lane, never raises it.
keys: github (read-only), airtable, asana, figma. Optional: anthropic (only with worker.auth=api-key), chromatic, npm (the gated publish step alone).
```

The crew resolves the names in `tables` and `fields` to the base's ids at startup, so a person who duplicates your base template changes only `baseId` and `token`. A person with a different base edits the name map. The client checks the base has every expected field on startup and reports what is missing. An example config file holds keys and names only, no secrets.

## Build-day checks
Claude Code flags, the Storybook static index filename, the Airtable field ids against the live base, the Figma MCP endpoints, the Asana API shapes.
