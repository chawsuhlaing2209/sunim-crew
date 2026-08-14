# tools.md — Sunim Crew (stack facts)

Facts only. Rules live in CLAUDE.md.

## Project
Sunim Crew. An installable agentic crew that takes a component from Figma to a published, documented design system, tracked on Airtable and orchestrated through Asana.

## Stack
| Layer | Pick |
|---|---|
| Language | TypeScript strict, ESM |
| Runner | Claude Code headless, one process per delegation |
| Validation | zod |
| Tests | vitest (unit), Chromatic (visual), Storybook (states) |
| Registry | npm, the published component library |
| Docs | Astro Starlight |
| Schedule | a daily routine for the manager sweep |

Node 20+. Prettier: semi true, singleQuote true, trailingComma all, printWidth 80, tabWidth 2.

## Source of truth and dashboard
Airtable base `appZaeKPj6g6ls6MO` (Sunim Design System) holds the data and the status. The Development field is a formula, never write it. The crew writes evidence fields, and the formula reacts.

Components table `tblej9RmBwH3kCR5N`:
- Figma `fldYcRaMUfGjKIL71`, Design `fldK2Dp1iUf2mG0M1`
- Commit `fldTfzIqK9dn3tCka`
- Storybook, the staging link `fldOuJpSivewZrGyt`, Staging URL `fld7nrL1kTQjuj6ka`
- Production URL `fldM0MT30IJzinv2X`, Astro Link `fldmIejCh2VfmBkmP`
- Development, formula `fldOLGT24LDXAzsZ7`, Synchronization % `fldmDi7UodNK4c2xZ`
- Total Tests `fldyYyEn5KfFGEuUu`, Passed Tests `fldlUuOcmKdDULk5q`, Testing Results Summary `fldwq0iaM1TdGJtEL`

Test rows table Storybook Testing `tblzVgnActM210oLc`: Testing Results `fldLpiJh4iuVf2Vkc` (Passed, Failed, Fixed (To re-test)), linked to Components via `fldjU0dkzPmQJ0Z3W`.

These ids belong to this base only. A duplicated base keeps the field and table names but gets new ids, so the crew never hardcodes an id. It addresses Airtable by name from config (below) and resolves names to the base's ids at startup. The ids above are for reference and for the one-time formula setup.

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
keys: anthropic, github (read-only), chromatic, npm
```

The crew resolves the names in `tables` and `fields` to the base's ids at startup, so a person who duplicates your base template changes only `baseId` and `token`. A person with a different base edits the name map. The client checks the base has every expected field on startup and reports what is missing. An example config file holds keys and names only, no secrets.

## Build-day checks
Claude Code flags, the Storybook static index filename, the Airtable field ids against the live base, the Figma MCP endpoints, the Asana API shapes.
