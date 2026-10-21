import { describe, it, expect } from 'vitest';
import { describeSummary, readContextFiles, readCount, unreadMessage } from '../src/lib/context';

const file = (name: string, body: string) => ({ name, size: body.length, text: async () => body });

describe('per-document read report', () => {
  it('counts requirements, User Flows and tables for a document', async () => {
    const body = [
      '# Spec',
      '## Sign in',
      'Users can sign in with email.',
      '## Reports',
      'Admins can export reports.',
      '',
      '| Role | Can do |',
      '| --- | --- |',
      '| admin | export |',
    ].join('\n');
    const { accepted } = await readContextFiles([file('spec.md', body)]);
    expect(accepted[0].unread).toBeUndefined();
    expect(accepted[0].summary).toEqual({ requirements: 3, journeys: 0, tables: 1, rules: 1 });
    expect(describeSummary(accepted[0].summary!)).toBe('3 requirements, 0 User Flows, 1 table');
  });
  it('words the line in the plural and singular', () => {
    expect(describeSummary({ requirements: 3, journeys: 4, tables: 2, rules: 0 })).toBe(
      '3 requirements, 4 User Flows, 2 tables'
    );
    expect(describeSummary({ requirements: 1, journeys: 1, tables: 1, rules: 0 })).toBe(
      '1 requirement, 1 User Flow, 1 table'
    );
  });
  it('flags a zero-yield document and does not count it as read', async () => {
    const { accepted, rejected } = await readContextFiles([
      file('notes.txt', 'just a sentence with no structure'),
      file('spec.md', '# Spec\n## Sign in\nUsers can sign in with email.'),
    ]);
    expect(rejected).toEqual([]);
    const notes = accepted.find((f) => f.name === 'notes.txt')!;
    expect(notes.unread).toBe(true);
    expect(unreadMessage(notes.name)).toBe('Nothing was read from notes.txt. Make sure it has headings, lists or tables.');
    expect(readCount(accepted)).toBe(accepted.filter((f) => f.name !== 'notes.txt').length);
  });
});
