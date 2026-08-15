# Sunim Crew

An installable agentic crew that takes a component from a design file to a published, documented library. Airtable holds the data and the status, Asana holds the work, Claude Code runs the workers, git holds the code, npm publishes, Astro documents.

Point it at your keys, your base, your Asana and your repo. Nothing of anyone else's is in the code.

## The one idea everything protects

Nobody writes the status.

The Airtable Development field is a formula. It reads the evidence and computes the stage:

| Evidence present, and verified | Stage |
| --- | --- |
| A design link, nothing built | To-do |
| A commit that resolves | To be staged |
| A staging link that answers | Ready for Testing |
| Test rows, any failed | To be fixed |
| Some rows marked fixed, some not | Fixing |
| Every row marked fixed | Fixed |
| Every row passed | To be deployed |
| A production URL and a docs page | Completed |

A worker does the craft and reports. The manager goes and checks the claim, and writes the evidence field only if it holds up. The formula reacts. So a worker can say anything it likes, and only what survives the check moves anything.

That is the whole design. Everything below is plumbing for it. The build fails if any code writes that field: `npm run check:status` scans the source for it, and CI runs that first, on its own, so a failure is unmistakable.

## What each worker cannot do

| Worker | Cannot |
| --- | --- |
| Engineer | Touch Airtable. Reports a commit; somebody else fetches it. |
| DevOps | Merge, or push to staging or main. Opens the pull request only. |
| QA | Hold any secret at all. Writes results to a file; somebody else records them. |
| Fix | Mark its own case fixed. Applies one suggestion and reports. |
| Docs | Record the page. Writes it; somebody else checks the sections. |

None of them holds the npm token. Publishing runs in the manager, after a named person approves, and nowhere else.

## Getting started

You need Node 20.19 or newer, Claude Code signed in, and accounts for Airtable, Asana, Figma and GitHub.

```bash
git clone https://github.com/chawsuhlaing2209/sunim-crew.git
cd sunim-crew
npm run setup
```

That installs, builds, copies `.env.example` to `.env`, and prints exactly what is still missing.

### 1. Fill in `.env`

Every name in it says where to get its value. Four are required to run at all:

| Name | Where |
| --- | --- |
| `AIRTABLE_TOKEN` | airtable.com/create/tokens, scopes `data.records:read`, `data.records:write`, `schema.bases:read` |
| `ASANA_TOKEN` | app.asana.com, Settings, Apps, personal access token |
| `FIGMA_TOKEN` | figma.com, Settings, Security, personal access tokens |
| `GITHUB_TOKEN` | Fine grained, **read only**, Contents: Read. It confirms a commit resolves and nothing else. |

There is deliberately no Anthropic key in that list. A worker is a headless Claude Code process and runs on your own sign-in, so a Claude plan is enough and no worker is ever handed `ANTHROPIC_API_KEY`, even when one is set. To spend metered API credit instead, say so once with `WORKER_AUTH=api-key`.

Secrets live in the environment and only there. Everything else, the base id, the table and field names, the workspace, the repo and its branches, can live in `.env` too or in `sunim.config.json`.

### 2. Make the base

```bash
npm run base:create -- wspYOURWORKSPACE
```

Schema only, no rows. It then prints three things to add by hand, once: the link field, the rollups, and the **Development formula**. That field has to be a formula. If it is a text or select field, somebody can drag a component forward without doing the work, and the crew refuses to start against a base where it is not a formula.

Already have a base? Skip this, put its id in `AIRTABLE_BASE_ID`, and if your fields are named differently, edit the name map rather than the code.

### 3. Check it lines up

```bash
npm run config:check     # what is set, secrets masked
npm run airtable:check   # resolves your base, read only
```

`airtable:check` prints every table and field it resolved, and marks the computed ones it will never write.

### 4. First sweep

Read what it would do before it does anything:

```bash
npm run sweep -- --dry-run
```

That composes every task and every worker prompt, and writes nothing. No Airtable field, no Asana comment, no deploy, no publish, no worker. It prints the list of things a real sweep would have done, in order, so you can read them before any of them happen.

Then, when it looks right:

```bash
npm run sweep
```

One pass, then stop. It reads the board, opens and assigns the subtask each component's status calls for, runs the workers, and checks every claim before writing any evidence.

`npm run sweep -- --no-workers` does the same without spawning anybody: subtasks opened and assigned, evidence checked, nothing spent. That is what a first run on a fresh base wants.

Every delegation leaves a line in `logs/delegations.jsonl`: who, how long, what it cost, how it ended. An agent that times out twice in a row is flagged by name in the sweep output, because the third attempt will spend the same time and money to find that out again.

## The daily routine

```bash
npm run schedule
```

Prints the crontab entry, which you add yourself. One entry, on one machine. The sweep is the only thing that writes evidence, and two of them running is two writers racing over one board, so a sweep that starts while another is still going stops and says who holds the lock.

## Shipping

Nothing reaches production or npm without a named person:

```bash
npm run approve -- Button
```

That posts an approval on the component's Deploy subtask under your own Asana name, tied to the exact commit. Change the code afterwards and the approval lapses. `approvers` in config lists who may do this, and an empty list means nobody can.

## Configuration

Two places, one shape. Secrets in the environment, everything else in `sunim.config.json` or in the environment, which wins when both are set.

- `.env.example`, every name with a note on where to get it
- `sunim.config.example.json`, the same values as a file

The crew addresses Airtable by **name**, and resolves those names to your base's ids at startup. A duplicated base needs one line changed.

## The documents

- `docs/first-run.md`, taking one component all the way through, step by step
- `CLAUDE.md`, the rules this project is built to
- `docs/crew.md`, the design, and the status table above in full
- `docs/component-contract.md`, what done means for a component and its docs page
- `docs/asana.md`, the task model
- `docs/security-checklist.md`, the trust model
- `BUILD-GUIDE.md`, how this was built, one step at a time
- `SECURITY.md`, what to do about a vulnerability
- `CONTRIBUTING.md`, how to work on it

## Licence

MIT. See `LICENSE`.
