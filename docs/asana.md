# Asana, the crew's task manager

Airtable holds the data and the status. Asana holds the work: who is doing what, and how far along. The two reference each other by the component name and the Airtable row link. Token and workspace come from config.

## The shape

One component is one Asana task. The task name is the component. Each lifecycle stage is a subtask:

| Subtask                    | Assigned to | Done when                                                                      |
| -------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Implementation             | Engineer    | Component built, Storybook previewed, vitest and Chromatic pass, commit pushed |
| Stage                      | DevOps      | Deployed to staging, staging Storybook link ready                              |
| Test                       | QA          | Every state and prop tested, rows written with screenshots                     |
| Fix (one per failed issue) | Engineer    | The specific issue fixed, row marked Fixed (To re-test)                        |
| Deploy                     | DevOps      | Production deployed, npm published (after the human gate)                      |
| Document                   | Manager     | Astro page written with every required section                                 |

## How the manager uses it

1. Reads Airtable for components whose derived status needs the next action.
2. Creates the component task and the next subtask if missing, and assigns the agent.
3. The agent picks up its subtask, does the craft, writes its result into the subtask, and marks it done.
4. The manager verifies the reported evidence (commit resolves, link is 200, rows are real), then writes the evidence field to Airtable. The formula reacts and the status moves.
5. On a failed test, the manager creates one Fix subtask per failed row, each carrying the issue, the expected result, and the suggestion.

## What agents may and may not do

- May: read their subtask, read the Figma node and the design source, do the craft, write their result into the subtask.
- May not: touch Airtable status, write evidence directly, or read another component's state.

The agent reports. The manager verifies and records. That split is what keeps the formula honest.
