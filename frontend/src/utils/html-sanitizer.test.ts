import { describe, it, expect } from 'vitest';
import { sanitizeEmailHtml, formatEmailSnippet } from './html-sanitizer.util';

describe('HTML Sanitizer & Snippet Utilities', () => {
  describe('formatEmailSnippet', () => {
    it('should return empty string for undefined or empty input', () => {
      expect(formatEmailSnippet('')).toBe('');
      expect(formatEmailSnippet(undefined)).toBe('');
    });

    it('should remove Attached Documents block from email body snippet', () => {
      const bodyWithAttachment =
        'Hello Testing 1<div style="margin-top: 20px; padding: 12px 16px;"><p>Attached Documents (1):</p><ul><li>📎 <strong>Doc.pdf</strong> (10 KB)</li></ul></div>';
      const snippet = formatEmailSnippet(bodyWithAttachment);
      expect(snippet).toBe('Hello Testing 1');
    });

    it('should remove all HTML tags and normalize extra spaces', () => {
      const rawHtml = '<p>Welcome to <strong>ReachInbox</strong>!</p>   <div>Next line.</div>';
      const snippet = formatEmailSnippet(rawHtml);
      expect(snippet).toBe('Welcome to ReachInbox! Next line.');
    });
  });

  describe('sanitizeEmailHtml', () => {
    it('should strip malicious script tags', () => {
      const unsafe = '<p>Safe text</p><script>alert("xss")</script>';
      const clean = sanitizeEmailHtml(unsafe);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('alert');
      expect(clean).toContain('Safe text');
    });

    it('should preserve safe styling and document attachment markup', () => {
      const attachmentHtml =
        '<div style="background-color: #f8fafc;"><p>Attached Documents (1):</p><ul><li>📎 <strong>File.pdf</strong></li></ul></div>';
      const clean = sanitizeEmailHtml(attachmentHtml);
      expect(clean).toContain('Attached Documents');
      expect(clean).toContain('File.pdf');
    });
  });
});
