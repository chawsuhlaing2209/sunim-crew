# The first run

Taking one component from a row in Airtable to a documented, published
component, with the crew doing the work. Read this once before starting any
of it.

## What this costs, and what it touches

Every stage after the dry run spawns a real Claude Code process against your
Anthropic key. The Implementation stage alone has a 45 minute ceiling. This is
not a free thing to run by accident.

It also writes to accounts of yours: tasks and comments on your Asana board,
evidence fields on your Airtable base, branches and pull requests on GitHub.
Steps 1 to 4 write nothing anywhere, and that is on purpose. Do them first.

Three things only a person can do, and the run stops at each until they do:

1. Put a Figma link on the component's row.
2. Merge the component's pull request into staging.
3. Approve the production deploy.

## 0. Decide who pays for the workers

A Claude subscription and Anthropic API credit are two separate meters. Max
does not top up API credit, and an API key never draws on Max.

The crew runs on a subscription unless somebody says otherwise, and that is
not a thing you have to remember to set up. No worker is handed
`ANTHROPIC_API_KEY`, even when one is sitting in `.env` or exported in a
shell, because a key that reaches a child by accident puts everybody onto
metered billing without anybody choosing it.

So all a person needs is to sign the CLI in once:

```bash
claude
/login
```

To spend metered API credit instead, say so on purpose:

```bash
WORKER_AUTH=api-key
```

### On a Pro plan

Everything works the same. What is different is the window: Pro's Claude Code
allowance is a good deal smaller than Max, and one engineer delegation can
take a large piece of it. Two settings are there for that.

```bash
WORKER_MODEL=sonnet
WORKER_MAX_MINUTES=20
```

`WORKER_MODEL` pins what every worker runs as, rather than leaving it to
whatever each person's default happens to be. `WORKER_MAX_MINUTES` lowers
every lane's ceiling, and only ever lowers it: the engineer's 45 minutes
becomes 20, and QA's shorter one stays as it was.

Expect a first component to take more than one sitting on Pro, and design the
exercise for that. A sweep is one pass and then it stops, so running it again
after a limit resets picks up exactly where the last one left off. Nothing is
lost, because everything already verified is written down.

When a worker runs out of window, the sweep stops spawning and says so,
including the reset time when the worker gives one. That is not a fault to go
and fix, and the message says as much.
`npm run config:check` prints which of the two it will be, in as many words.
Check it rather than assuming, because the failure mode of getting this wrong
is a worker that dies in seven seconds saying "Credit balance is too low".

If the first worker of a sweep fails that way, or because nobody is signed
in, the sweep stops spawning for the rest of the run. One broken key does not
become one failed task per component.

## Before anything

- Claude Code signed in on this machine. The crew spawns it as a subprocess.
- The Figma desktop app open, with Dev Mode's MCP server enabled, and the file
  open. See step 2, this is not optional and not the default.
- `npm ci` in this repo.

## 1. Point the crew at the design system

In `.env`:

```bash
REPO_PATH_OR_URL=/Users/chawsuhlaing/CLAUDE CODE/sunim-ds
GITHUB_REPO=chawsuhlaing2209/sunim-ds
REPO_STAGE_COMMAND=npm run deploy:pages
REPO_PRODUCTION_COMMAND=npm run deploy:pages
DOCS_PATH=/Users/chawsuhlaing/CLAUDE CODE/sunim-ds/docs/src/content/docs/components
DOCS_URL_TEMPLATE=https://chawsuhlaing2209.github.io/sunim-ds/components/{slug}
```

`GITHUB_REPO` is what lets the manager fetch a commit URL and confirm it
resolves. Without it a commit can never become evidence.

`approvers` has no environment variable, deliberately: the list of people who
may ship to production belongs in a file somebody can read and review, not in
a shell. Create `sunim.config.json`:

```json
{
  "approvers": ["Your Name As Asana Shows It"]
}
```

The name has to match what Asana puts on your comment, character for
character. An empty list means nothing can ever be approved, which is the
safe way round.

## 2. Point Figma at the local Dev Mode server

```bash
FIGMA_MCP_URL=http://127.0.0.1:3845/mcp
```

The hosted server at `mcp.figma.com` does not work with a personal access
token. It answers a `figd_` token in an Authorization header with "figd_
tokens must be passed via X-Figma-Token header, not Authorization", and
answers the same token in `X-Figma-Token` with a plain 401. The hosted server
wants an OAuth flow the crew does not do.

The Dev Mode server that the Figma desktop app runs on this machine needs no
token at all. It authenticates through the app you are already signed in to,
and it exposes exactly the four tools the engineer is allowed to use:
`get_design_context`, `get_variable_defs`, `get_screenshot`, `get_metadata`.

Check it is up before you rely on it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3845/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

200 means it is there. Anything else means the desktop app is closed, or Dev
Mode's MCP server is switched off in its preferences.

The consequence of this being local: the engineer only works while the Figma
app is open on this machine. A crew running from a scheduled sweep at 09:00
on a laptop with Figma closed will fail every Implementation stage.

## 3. Put a Figma link on the row

In the Components table, on the Button row, set **Figma** to the URL of the
Button component in your file, with the node id:

```
https://www.figma.com/design/<fileKey>/<name>?node-id=<node>
```

Copy it from Figma with right click, Copy link to selection. Without this the
engineer refuses the component and says so, which is correct behaviour and
not a bug.

## 4. Check the wiring, without touching anything

```bash
npm run config:check
npm run airtable:check
```

The first prints every value with secrets masked and says where each came
from. The second resolves your base read only, prints all sixteen fields, and
marks the four it will never write. If the Development field is not a formula
it refuses to start, which is the whole design defending itself.

## 5. Read what it would do

```bash
npm run sweep -- --dry-run
```

Composes every task and every worker prompt and writes nothing anywhere. No
Airtable field, no Asana comment, no deploy, no publish, no worker. It prints
each thing a real sweep would have done, in order.

Read the engineer's prompt in that output properly. It is the whole
instruction a worker gets, and it is much cheaper to find a problem here than
45 minutes into a delegation.

## 6. The first real sweep, spawning nobody

```bash
npm run sweep -- --no-workers
```

This is the first time anything writes to your Asana board. It creates the
Button task, opens the Implementation subtask, assigns it, and stops. No
worker runs and nothing is spent.

Go and look at the board. The task should carry a link back to the Airtable
row, and the subtask should carry the done-when line for its stage.

## 7. Build the component

```bash
npm run sweep
```

The engineer now runs for real: reads the design through the MCP, builds the
component, its stories, its tests and its contract file, runs the build and
the tests, commits and pushes `component/button`.

Watch it: `logs/<timestamp>-button-implementation.log`, with the exact prompt
beside it in `.prompt.md`. Up to 45 minutes.

When it finishes, the manager fetches the commit URL it reported and checks
the commit resolves on GitHub before writing anything. If the worker reported
a commit it never pushed, nothing is written, the subtask reopens, and the
sweep says so.

Run the sweep again afterwards. With **Commit** filled in, the formula moves
Button to **To be staged** on its own. Nobody wrote that status.

## 8. Get it onto staging

The DevOps worker opens a pull request from `component/button` into
`staging`, and does not merge it. Then it deploys staging and looks for the
component.

**This is where the run pauses for you.** The deploy cannot contain a
component whose pull request has not been merged, so the worker will report
that it could not find Button on staging. That is not a failure of the
component. Merge the pull request yourself, then run `npm run sweep` again
and the same stage will find it.

Expect one wasted delegation here the first time. If you want to avoid it,
merge the pull request as soon as it appears, before the deploy runs.

Once the staging Storybook link answers, the manager writes **Storybook** and
Button moves to **Ready for Testing**.

## 9. Testing, and the one thing missing

QA is allowed to run `npx playwright` and `npm run` in the design system
repo, and it has to produce one screenshot per case. `sunim-ds` has nothing
installed that can drive a browser and take a picture of a story.

So before this stage, add one. Playwright with a small script that opens
`iframe.html?id=<storybookId>` for each story and saves a PNG is enough. QA
writes its results and screenshots to disk; the manager turns them into rows
and attaches the images, because QA holds no key and touches no base.

A row with no attachment does not count as tested, which is what stops a
worker claiming a component passes without ever having looked at it.

`variants x sizes x states` from the contract is how many cases QA owes.

## 10. Fixes, if any case failed

Nothing to run. The next sweep opens one Fix subtask per failed row, each
carrying only that case, its expected result and its suggestion. One worker
per case, applying the suggestion without re-diagnosing it.

The worker cannot mark its own case fixed. The manager marks the row after
the worker has actually run and reported, because a worker that could mark
its own case fixed could mark every case fixed and the retest would be
checking nothing.

When every row is marked, Button goes back to QA as **Fixed**, gets retested,
and reaches **To be deployed** when every case passes.

## 11. The human gate

Nothing happens here until a named person says so.

```bash
npm run approve -- Button
```

This posts the approval on the Deploy subtask using your own Asana token, so
Asana records your name against it. It is bound to the exact commit: push
anything to the component afterwards and the approval lapses and has to be
given again.

**Before you run the sweep after approving, decide about npm.** The release
runs the production deploy and then `npm publish`, for real, to the public
registry. For a test run:

```bash
NPM_PUBLISH_COMMAND=npm publish --dry-run
```

That exercises the whole gated path without putting a package on the
registry. Note the release refuses to run at all without `NPM_TOKEN` set, so
this is how you test it rather than by leaving the token out.

Then `npm run sweep`. It deploys production first and publishes second,
because a deploy can be rolled back and a published package cannot be
cleanly unpublished. The manager checks the production URL answers before
writing it.

## 12. The docs page

The next sweep opens the Document subtask, a worker writes the page into
`docs/src/content/docs/components/button.mdx` with all eight required
sections, and the manager fetches the page and checks every section is
present.

It checks presence, never quality. It posts a comment saying exactly that,
because the machine check is not the whole story and a person still has to
read the writing.

With **Production URL** and **Astro Link** both filled in, the formula reads
**Completed**.

## When it goes wrong

- `npm run sweep` says a claim did not check out: that is the system working.
  Nothing was written, the subtask is open again, and the worker was told
  what failed on its own subtask.
- An agent flagged for timing out twice in a row: read the last log in
  `logs/` before running it again. It will spend the same time and money to
  fail the same way a third time.
- A sweep says another sweep is running: that is the lock. There is one
  writer of evidence, and it is enforced rather than assumed. If a machine
  died mid sweep, the lock is taken over automatically after six hours.
- Nothing ever writes the Development field. If a component is not moving,
  the evidence it needs is missing or did not check out. Look at the
  evidence, not at the status.

## The cheapest useful test

If you only want to know the wiring is right, steps 1 to 6 cost nothing and
spawn nobody. They prove config, the base, the formula, the composed prompts,
and the board. Everything after that is the crew actually doing the work.
