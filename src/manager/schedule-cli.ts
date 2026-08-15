import { join } from 'node:path';
import { SWEEP_SCHEDULE, crontabLine } from './schedule.js';

/**
 * Print the daily entry. Printing rather than installing, on purpose: a
 * scheduled job that turns up on somebody's machine without them putting it
 * there is a surprise, and this one spends money and opens tasks.
 */
function main(): number {
  const dir = process.cwd();
  const logPath = join(dir, 'logs', 'sweep.log');

  console.log(`The manager sweeps ${SWEEP_SCHEDULE.description}.`);
  console.log('');
  console.log('Add this to your crontab, with crontab -e:');
  console.log('');
  console.log(`  ${crontabLine(dir, logPath)}`);
  console.log('');
  console.log(
    'One entry, on one machine. The sweep is the only thing that writes evidence, and two of them on two machines is two writers racing over the same board. If you need it somewhere else, move it, do not add a second.',
  );
  console.log('');
  console.log(
    'It refuses to start if another sweep is still going, so a run you start by hand while the daily one is working will stop and say so rather than write over it.',
  );
  console.log('');
  console.log('Read what it will do first:');
  console.log('');
  console.log('  npm run sweep -- --dry-run');

  return 0;
}

process.exit(main());
