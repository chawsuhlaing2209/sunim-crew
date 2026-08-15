import { join } from 'node:path';
import { hostname } from 'node:os';
import { getConfig } from '../config/index.js';
import { describeFlag } from '../runner/index.js';
import { crew } from './crew.js';
import { describeDryRun } from './dry-run.js';
import { LOCK_FILE, SWEEP_SCHEDULE, withSingleWriter } from './schedule.js';
import { describeSweep, sweep } from './sweep.js';

const USAGE = `
npm run sweep [-- --dry-run] [--no-workers]

One pass over the board, then stop. No loop and no polling: the daily
routine calls this, ${SWEEP_SCHEDULE.description}.

  --dry-run     Compose every task and prompt, and write nothing anywhere.
                Nothing is deployed, nothing is published, no worker is
                spawned. Read this before the first real run.
  --no-workers  Open and assign the subtasks, check the evidence already
                reported, and spawn nobody. What a person picking up the
                work needs, and what a first run on a fresh base should do.
`.trim();

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const unknown = args.filter(
    (arg) => !['--dry-run', '--no-workers'].includes(arg),
  );
  if (unknown.length > 0) {
    console.error(`I do not know ${unknown.join(', ')}.\n\n${USAGE}`);
    return 1;
  }

  const dry = args.includes('--dry-run');
  const config = getConfig();

  const assembled = await crew(config, {
    dryRun: dry,
    workers: !args.includes('--no-workers'),
  });

  if (dry) console.log('Dry run. Nothing below this line actually happened.\n');

  // One writer of evidence, enforced rather than assumed. A sweep somebody
  // starts by hand while the daily one is still going stops here.
  const locked = await withSingleWriter(
    join(assembled.runDir, LOCK_FILE),
    async () => await sweep(assembled.deps),
    { host: hostname() },
  );

  if (!locked.ran) {
    console.error(
      `A sweep is already running (${locked.heldBy}). Two sweeps writing the same board is exactly what this refuses to do.`,
    );
    return 1;
  }

  const report = locked.value;
  console.log(describeSweep(report));

  if (assembled.log !== undefined) {
    console.log('');
    console.log(describeDryRun(assembled.log));
    console.log('');
    console.log(
      'Nothing was written to Airtable, nothing was posted to Asana, nothing was deployed or published, and no worker ran.',
    );
    return 0;
  }

  if (assembled.flags.length > 0) {
    console.log('');
    for (const flag of assembled.flags) console.log(describeFlag(flag));
  }

  if (report.flagged.length > 0) {
    console.log('');
    console.log(
      `${report.flagged.length} flagged. Somebody claimed something that did not check out, and nothing was written for those.`,
    );
    return 1;
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
