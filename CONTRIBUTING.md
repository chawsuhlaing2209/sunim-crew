# Contributing

## The rules this is built to

Read `CLAUDE.md` first. It is short and it is the law here. The three that matter most:

1. **Nobody writes the status.** It is derived from evidence. If a change would let any code set it, the change is wrong.
2. **Evidence is verified before it is written.** A worker reports, the manager checks, and only then does anything land.
3. **A human approves before anything public.** Production and npm are gated, and that gate is not configurable away.

A change that weakens any of those needs a very good argument, and probably belongs in `docs/crew.md` as a design change first.

## Getting set up

```bash
npm run setup
npm test
```

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run format
npm test
npm run build
```

All five, all clean.

## How the tests are expected to work

**A test that cannot fail is not a test.** Before you trust a new one, break the code it covers on purpose and watch it go red. Two tests in this repo passed for the wrong reason and were only caught that way, and both are written up in the history.

**No test touches a network or a real account.** Every outside surface has a seam: `RecordGateway` for Airtable, `AsanaGateway` for Asana, an injected `fetch` for the verify layer, an injected `spawn` for the runner. Use them.

**The fake Airtable derives status the way the real formula does.** That is deliberate. It means "the status did not move" is something a test can actually check, rather than a restatement of the setup.

## Style

TypeScript strict, ESM, Node 20.19 or newer. Prettier and eslint decide formatting, so do not argue with them, run them.

Comments explain **why**, not what. If a line needs a comment saying what it does, rename something instead.

No em dashes anywhere, in code or prose. No design system jargon.

## Adding a config value

Everything specific to a project is config. To add one:

1. Put it in `src/config/schema.ts`, with a default if a sensible one exists.
2. It gets an environment name automatically for tables, fields and agents. Anything else needs a line in `OVERRIDES` in `src/config/env.ts`.
3. Add it to `.env.example` and `sunim.config.example.json`.
4. `src/config/no-hardcoding.test.ts` will tell you if you left a real value in the code.

## Adding a worker lane

Look at `src/lanes/stage.ts` as the model. A lane:

- composes a delegation, and spawns exactly one process
- gets the smallest tool list and the smallest environment that will do
- **reports, and records nothing.** If your lane needs to write to Airtable, it is doing the manager's job

Then wire it into `sweep()` and write the failure cases first: a worker that times out, one that reports nothing checkable, and one that lies.
