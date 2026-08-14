# Sunim Crew

An installable agentic crew that ships design system components. Airtable holds the data and the status, Asana holds the crew's tasks, git holds the code, npm publishes the library, Astro documents it.

## Build it

Open `BUILD-GUIDE.md`. Each step is one prompt you paste into Claude Code. Build one step, read the diff, run it, commit, then move on.

## The rule that matters

Nobody writes the status. The Airtable Development field is a formula derived from verified evidence. The manager writes evidence only after it checks the commit resolves, the link returns 200, and the test rows are real. A human approves before anything goes public.

## Layout

```
sunim-crew/
├── BUILD-GUIDE.md            the step-by-step prompts
├── CLAUDE.md                 project law
├── tools.md                  stack, config, the Airtable field map
└── docs/
    ├── crew.md               north star: roles, evidence-to-status, the gate
    ├── asana.md              the task model
    ├── component-contract.md what "done" means per component
    ├── security-checklist.md the hardening pass
    └── install-and-test.md   point the crew at a fresh or existing repo
```

The crew is a separate repo from the design system it builds. Point it at any design system repo through config.
