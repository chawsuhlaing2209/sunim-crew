import { getConfig } from '../config/index.js';
import { connect } from './client.js';
import { DEVELOPMENT_STATUSES } from './types.js';

/**
 * Read only. Resolves the name map against the live base, prints what it
 * found, and counts the components at each derived stage. Writes nothing.
 */
async function main(): Promise<number> {
  const config = getConfig();
  const client = await connect(config);
  const { schema } = client;

  console.log(`Base ${schema.baseId}\n`);
  for (const table of Object.values(schema.tables)) {
    console.log(`  table  ${table.name}  ${table.id}`);
  }
  console.log('');
  for (const field of Object.values(schema.fields)) {
    const note = field.computed
      ? `  computed, ${field.type}, never written`
      : '';
    console.log(`  field  ${field.name.padEnd(20)} ${field.id}${note}`);
  }

  const components = await client.listComponents();
  console.log(`\n${components.length} components\n`);
  for (const status of DEVELOPMENT_STATUSES) {
    const at = components.filter((row) => row.status === status);
    if (at.length > 0) {
      console.log(`  ${String(at.length).padStart(3)}  ${status}`);
    }
  }

  const unknown = components.filter(
    (row) => row.status === undefined && row.statusRaw !== undefined,
  );
  for (const row of unknown) {
    console.log(`  note: ${row.name} reads "${row.statusRaw}", which is new`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
