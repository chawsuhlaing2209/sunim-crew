import type { ComponentKey } from './types.js';

/**
 * The pairing between a task and its Airtable row lives in the task
 * description, in a block a person can read and a machine can parse. The task
 * name alone is not enough: two people can name two components the same, and
 * a rename would break the link. The record id is what actually keys it.
 */
export const KEY_MARKER = 'Sunim Crew, do not edit below this line';

export function renderKey(key: ComponentKey): string {
  const lines = [
    KEY_MARKER,
    `component: ${key.component}`,
    `airtable-record: ${key.recordId}`,
  ];
  if (key.rowUrl !== undefined) lines.push(`airtable-row: ${key.rowUrl}`);
  return lines.join('\n');
}

/** Put a human description above the key block, keeping the block intact. */
export function withKey(description: string, key: ComponentKey): string {
  const body = description.trim();
  return body === '' ? renderKey(key) : `${body}\n\n${renderKey(key)}`;
}

export function parseKey(notes: string): ComponentKey | undefined {
  if (!notes.includes(KEY_MARKER)) return undefined;

  const read = (label: string): string | undefined => {
    const match = new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(notes);
    const value = match?.[1]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  const component = read('component');
  const recordId = read('airtable-record');
  if (component === undefined || recordId === undefined) return undefined;

  const rowUrl = read('airtable-row');
  return { component, recordId, ...(rowUrl === undefined ? {} : { rowUrl }) };
}

/** The Airtable deep link for a row, so the task points back at the data. */
export function airtableRowUrl(
  baseId: string,
  tableId: string,
  recordId: string,
): string {
  return `https://airtable.com/${baseId}/${tableId}/${recordId}`;
}
