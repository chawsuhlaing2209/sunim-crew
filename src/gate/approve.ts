import { connect as airtableConnect } from '../airtable/index.js';
import { connect as asanaConnect } from '../asana/index.js';
import { getConfig } from '../config/index.js';
import { renderApproval } from './approval.js';

/**
 * The signed-in command. A person runs this with their own Asana token, so
 * Asana records the approval under their name, exactly as if they had typed
 * it into the app. There is no separate approval store to trust.
 *
 *   npm run approve -- Button
 */
async function main(): Promise<number> {
  const name = process.argv.slice(2).join(' ').trim();
  if (name === '') {
    console.error('Which component? npm run approve -- Button');
    return 1;
  }

  const config = getConfig();
  const airtable = await airtableConnect(config);
  const asana = asanaConnect(config);

  const component = await airtable.findComponentByName(name);
  if (component === undefined) {
    console.error(`No component called "${name}" in the base.`);
    return 1;
  }

  if (component.status !== 'To be deployed') {
    console.error(
      `${component.name} reads ${String(component.status ?? 'nothing')}, not To be deployed. Only a component that has passed its tests can be approved.`,
    );
    return 1;
  }

  if (component.commit === undefined) {
    console.error(`${component.name} has no commit recorded.`);
    return 1;
  }

  const task = await asana.ensureComponentTask({
    component: component.name,
    recordId: component.id,
  });
  const subtask = await asana.ensureSubtask(task.gid, 'Deploy');

  await asana.reportOnSubtask(
    subtask.gid,
    renderApproval(component.name, component.commit),
  );

  console.log(`Approved ${component.name} at ${component.commit}.`);
  console.log(
    'The next sweep will deploy production and publish. If the code changes before then, the approval lapses and somebody has to look again.',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
