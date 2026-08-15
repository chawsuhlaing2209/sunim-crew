import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config/index.js';

/**
 * Create the base from the shipped template, schema only.
 *
 * The link field, the rollups and the Development formula cannot be made in
 * the same call as the tables they depend on, so this creates the tables and
 * then prints what to add by hand. That is one pass through the Airtable UI,
 * once, and the formula is the part worth doing carefully.
 */
interface Template {
  name: string;
  tables: { name: string; description?: string; fields: unknown[] }[];
  $afterwards: {
    link: Record<string, string>;
    rollups: string[];
    developmentFormula: { field: string; formula: string };
  };
}

async function main(): Promise<number> {
  const workspaceId = process.argv[2];
  if (workspaceId === undefined || !/^wsp[A-Za-z0-9]+$/.test(workspaceId)) {
    console.error(
      'Which workspace? npm run base:create -- wspXXXXXXXXXXXX\nFind the id in the URL of your Airtable workspace.',
    );
    return 1;
  }

  const config = getConfig();
  const path = fileURLToPath(
    new URL('../../airtable/base-template.json', import.meta.url),
  );
  const template = JSON.parse(await readFile(path, 'utf8')) as Template;

  const response = await fetch('https://api.airtable.com/v0/meta/bases', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.airtable.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: template.name,
      workspaceId,
      tables: template.tables.map((table) => ({
        name: table.name,
        ...(table.description === undefined
          ? {}
          : { description: table.description }),
        fields: table.fields,
      })),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(
      `Airtable refused to create the base: ${response.status}. ${detail.slice(0, 300)}`,
    );
    console.error(
      'The token needs the schema.bases:write scope and access to that workspace.',
    );
    return 1;
  }

  const created = (await response.json()) as { id?: string };
  console.log(`Created ${template.name}: ${created.id ?? 'unknown id'}`);
  console.log('');
  console.log('Set this in your .env:');
  console.log(`  AIRTABLE_BASE_ID=${created.id ?? ''}`);
  console.log('');
  console.log('Then add these by hand, once. They depend on the tables:');
  console.log(
    `  1. ${template.$afterwards.link['table']}: a link field "${template.$afterwards.link['field']}" pointing at ${template.$afterwards.link['linkedTo']}`,
  );
  for (const rollup of template.$afterwards.rollups) {
    console.log(`  2. ${rollup}`);
  }
  console.log(
    `  3. Components: a formula field "${template.$afterwards.developmentFormula.field}".`,
  );
  console.log('');
  console.log(
    'That formula is the whole design. It has to be a formula, not a select, or somebody can drag a component forward without doing the work. The crew checks this at startup and refuses a base where it is not.',
  );
  console.log('');
  console.log(template.$afterwards.developmentFormula.formula);

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
