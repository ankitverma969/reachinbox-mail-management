import { describe, it, expect } from 'vitest';
import { parseLeadsContent, parseLeadsText } from './csv-parser.util';

describe('CSV & Lead Parser Service', () => {
  it('parses standard CSV with "email" column header', () => {
    const csv = `email,first_name,company
john.doe@reachinbox.test,John,ReachInbox
jane.smith@outbox.test,Jane,Outbox`;

    const result = parseLeadsContent(csv);

    expect(result.validEmails).toEqual([
      'john.doe@reachinbox.test',
      'jane.smith@outbox.test'
    ]);
    expect(result.duplicateCount).toBe(0);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.totalRows).toBe(2);
  });

  it('normalizes uppercase emails and eliminates duplicates', () => {
    const csv = `Email,Name
ALICE@EXAMPLE.COM,Alice
alice@example.com,Alice Duplicate
BOB@EXAMPLE.COM,Bob`;

    const result = parseLeadsContent(csv);

    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalRows).toBe(3);
  });

  it('identifies alternative column names like "recipient" and "lead_email"', () => {
    const csv = `id,Lead_Email,Status
1,contact1@sales.com,Active
2,contact2@sales.com,Active`;

    const result = parseLeadsContent(csv);

    expect(result.validEmails).toEqual(['contact1@sales.com', 'contact2@sales.com']);
    expect(result.validEmails).toHaveLength(2);
  });

  it('filters invalid email addresses and records row diagnostics', () => {
    const csv = `email,role
valid@domain.org,Admin
not-an-email,Engineer
missing-domain@,Marketing
another.good@domain.com,Executive`;

    const result = parseLeadsContent(csv);

    expect(result.validEmails).toEqual(['valid@domain.org', 'another.good@domain.com']);
    expect(result.invalidRows).toHaveLength(2);
    expect(result.invalidRows[0].value).toBe('not-an-email');
    expect(result.invalidRows[1].value).toBe('missing-domain@');
  });

  it('handles plain text lists with newlines and commas', () => {
    const text = `user1@reach.com
user2@reach.com, user3@reach.com
user1@reach.com`;

    const result = parseLeadsText(text);

    expect(result.validEmails).toContain('user1@reach.com');
    expect(result.validEmails).toContain('user2@reach.com');
    expect(result.validEmails).toContain('user3@reach.com');
    expect(result.duplicateCount).toBe(1);
  });

  it('gracefully handles empty content', () => {
    const result = parseLeadsContent('   \n  ');

    expect(result.validEmails).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.totalRows).toBe(0);
  });
});
