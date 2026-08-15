import { describe, expect, it } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import type { AgentReport, AsanaClient } from '../asana/index.js';
import {
  APPROVAL_MARKER,
  parseApproval,
  readApproval,
  renderApproval,
} from './index.js';

const COMMIT = 'https://github.com/owner/ds/commit/abc1234';

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'To be deployed',
    statusRaw: 'To be deployed',
    figma: undefined,
    design: undefined,
    commit: COMMIT,
    storybook: 'https://staging.example.com/sb/',
    stagingUrl: undefined,
    productionUrl: undefined,
    astro: undefined,
    totalTests: 4,
    passedTests: 4,
    synchronization: undefined,
    ...overrides,
  };
}

function comment(
  text: string,
  authorName: string,
  authorGid = 'user-1',
): AgentReport {
  return {
    text,
    source: 'comment',
    authorGid,
    authorName,
    createdAt: '2026-08-15T10:00:00.000Z',
  };
}

function asanaWith(comments: AgentReport[]): AsanaClient {
  return {
    listComments: () => Promise.resolve(comments),
  } as unknown as AsanaClient;
}

describe('the approval record', () => {
  it('round trips', () => {
    expect(parseApproval(renderApproval('Button', COMMIT))).toEqual({
      component: 'Button',
      commit: COMMIT,
    });
  });

  it('is nothing without the marker', () => {
    expect(parseApproval('looks good to me, ship it')).toBeUndefined();
    expect(
      parseApproval(`${APPROVAL_MARKER}\ncomponent: Button`),
    ).toBeUndefined();
  });
});

describe('readApproval', () => {
  const approvers = ['Chaw Su'];

  it('approves when a named person approved this commit', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([comment(renderApproval('Button', COMMIT), 'Chaw Su')]),
      approvers,
    });

    expect(verdict.approved).toBe(true);
    expect(verdict.approved && verdict.approval.by).toBe('Chaw Su');
  });

  it('waits when nobody has approved', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([comment('Deployed to staging, looks fine', 'DevOps')]),
      approvers,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('waiting for a person');
  });

  it('refuses an approval from somebody who may not approve', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([
        comment(renderApproval('Button', COMMIT), 'Someone Else', 'user-9'),
      ]),
      approvers,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('not a named approver');
  });

  it('refuses an approval for a commit the component has moved past', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([
        comment(
          renderApproval(
            'Button',
            'https://github.com/owner/ds/commit/old0000',
          ),
          'Chaw Su',
        ),
      ]),
      approvers,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('has lapsed');
  });

  it('refuses everything when nobody is listed as an approver', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([comment(renderApproval('Button', COMMIT), 'Chaw Su')]),
      approvers: [],
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('nobody is listed as an approver');
  });

  it('takes a gid as well as a name', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([
        comment(renderApproval('Button', COMMIT), 'Whoever', 'user-42'),
      ]),
      approvers: ['user-42'],
    });

    expect(verdict.approved).toBe(true);
  });

  it('lets a later approval supersede an earlier one', async () => {
    const verdict = await readApproval(component(), 'sub-deploy', {
      asana: asanaWith([
        comment(
          renderApproval(
            'Button',
            'https://github.com/owner/ds/commit/old0000',
          ),
          'Chaw Su',
        ),
        comment(renderApproval('Button', COMMIT), 'Chaw Su'),
      ]),
      approvers,
    });

    expect(verdict.approved).toBe(true);
  });

  it('refuses a component with no commit to approve', async () => {
    const verdict = await readApproval(
      component({ commit: undefined }),
      'sub-deploy',
      {
        asana: asanaWith([
          comment(renderApproval('Button', COMMIT), 'Chaw Su'),
        ]),
        approvers,
      },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('no commit recorded');
  });
});
