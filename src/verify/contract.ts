import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { fail, pass } from './types.js';
import type { Result } from './types.js';

const nonEmpty = z.string().min(1, 'must not be empty');
const list = z.array(nonEmpty).min(1, 'must list at least one');

/**
 * The contract file, exactly as docs/component-contract.md describes it.
 * Machine readable, ships with the component, read by an agent and by the
 * manager. Presence and shape only, never taste.
 */
export const contractSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'must be kebab case, like button-group'),
  name: nonEmpty,
  props: z.record(z.string(), z.unknown()),
  variants: list,
  sizes: list,
  states: list,
  tokens: list,
  a11y: z.object({
    role: nonEmpty,
    focusOrder: nonEmpty,
    contrast: nonEmpty,
  }),
  usage: z.object({
    whenToUse: nonEmpty,
    whenNot: nonEmpty,
  }),
  storybookId: nonEmpty,
  astroDocsUrl: z
    .string()
    .regex(/^https?:\/\/\S+$/, 'must be an http or https url'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'must be a semver version, like 1.0.0'),
});

export type Contract = z.infer<typeof contractSchema>;

/**
 * The doc calls the contract jsonc, so comments and a trailing comma are
 * allowed. Strings are stepped over, so a // inside a URL survives.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index] ?? '';
    const next = text[index + 1] ?? '';

    if (char === '"') {
      out += char;
      index += 1;
      while (index < text.length) {
        const inner = text[index] ?? '';
        out += inner;
        index += 1;
        if (inner === '\\') {
          out += text[index] ?? '';
          index += 1;
          continue;
        }
        if (inner === '"') break;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === '*' && text[index + 1] === '/')
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as unknown;
}

/**
 * Does the contract file exist and validate. Every later check leans on it:
 * the variants QA tests, the tokens the docs list, the version the changelog
 * shows. A contract that does not parse stops the lane here.
 */
export async function contractValid(path: string): Promise<Result> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    return fail(`no contract file at ${path}`, { path, error: String(error) });
  }

  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (error) {
    return fail(`contract file is not valid JSON: ${String(error)}`, { path });
  }

  const result = contractSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`,
    );
    return fail(`contract file does not validate: ${problems.join('; ')}`, {
      path,
      problems,
    });
  }

  const contract = result.data;
  return pass(
    `contract for ${contract.name} validates, version ${contract.version}, ${contract.variants.length} variants, ${contract.states.length} states`,
    {
      path,
      id: contract.id,
      name: contract.name,
      version: contract.version,
      variants: contract.variants,
      sizes: contract.sizes,
      states: contract.states,
      tokens: contract.tokens,
      storybookId: contract.storybookId,
      astroDocsUrl: contract.astroDocsUrl,
      // How many test rows QA owes for this component.
      expectedCases:
        contract.variants.length *
        contract.sizes.length *
        contract.states.length,
    },
  );
}
