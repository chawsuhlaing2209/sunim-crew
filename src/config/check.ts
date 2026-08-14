import {
  ConfigError,
  DEFAULT_CONFIG_FILE,
  OPTIONAL_SECRET_KEYS,
  loadConfig,
  readProjectFile,
  report,
} from './index.js';

/**
 * A doctor for the config. Prints what is set, where it came from, and what is
 * missing, with every secret masked. Run it after copying the example files.
 */
function main(): number {
  const optional = new Set<string>([
    ...OPTIONAL_SECRET_KEYS,
    'figma.fileKey',
    'repo.slug',
  ]);

  let file: { path: string; data: unknown } | undefined;
  try {
    file = readProjectFile();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    return 1;
  }

  console.log('Sunim Crew configuration\n');
  console.log(
    file === undefined
      ? `  no ${DEFAULT_CONFIG_FILE} found, reading the environment only\n`
      : `  reading ${file.path}\n`,
  );

  const rows = report({ project: file?.data });
  const width = Math.max(...rows.map((row) => row.name.length));
  for (const row of rows) {
    const mark =
      row.state === 'missing' ? (optional.has(row.name) ? '-' : 'x') : 'ok';
    console.log(`  ${mark.padEnd(3)} ${row.name.padEnd(width)}  ${row.detail}`);
  }
  console.log('');

  try {
    loadConfig({ project: file?.data });
    console.log(
      'Config loads. Every project value came from config, none from code.',
    );
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exit(main());
