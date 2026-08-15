import { connect as airtableConnect } from '../airtable/index.js';
import { connect as asanaConnect } from '../asana/index.js';
import { getConfig } from '../config/index.js';
import { describeSweep, sweep, verifyPort } from './index.js';

/**
 * One sweep, then stop.
 *
 * No lanes are wired here. This reads the board, opens and assigns the
 * subtask each component's status calls for, and checks any evidence a worker
 * has already reported. It spawns nobody and spends nothing, which is what a
 * first run on a fresh base should do.
 *
 * Wiring the lanes in is how the crew starts doing the craft itself. That is
 * a decision to make deliberately, not a thing to inherit from a default.
 */
async function main(): Promise<number> {
  const config = getConfig();
  const airtable = await airtableConnect(config);
  const asana = asanaConnect(config);

  const report = await sweep({
    config,
    airtable,
    asana,
    verify: verifyPort(config, airtable),
  });

  console.log(describeSweep(report));

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
