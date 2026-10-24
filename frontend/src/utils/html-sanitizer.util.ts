/**
 * HTML Sanitization and Snippet Extraction Utilities
 * Ensures email HTML bodies and attachments render safely and beautifully without XSS vulnerabilities.
 */

/**
 * Sanitizes an HTML string using the native browser DOMParser.
 * Removes all executable scripts, iframes, embedded objects, and event handlers.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  // Safe fallback if executed outside browser environment (e.g., node / vitest)
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // 1. Remove dangerous executable tags
    const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link', 'applet'];
    dangerousTags.forEach((tag) => {
      const elements = doc.querySelectorAll(tag);
      elements.forEach((el) => el.remove());
    });

    // 2. Remove dangerous inline attributes and protocol handlers
    const allElements = doc.querySelectorAll('*');
    allElements.forEach((el) => {
      const attributes = Array.from(el.attributes);
      for (const attr of attributes) {
        const name = attr.name.toLowerCase();
        const value = attr.value.toLowerCase().trim();

        // Strip inline event listeners (onclick, onload, onerror, etc.)
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          continue;
        }

        // Strip javascript: or vbscript: or data:text/html protocols
        if (
          (name === 'href' || name === 'src' || name === 'action') &&
          (value.startsWith('javascript:') || value.startsWith('vbscript:') || value.startsWith('data:text/html'))
        ) {
          el.removeAttribute(attr.name);
        }
      }
    });

    return doc.body.innerHTML;
  } catch {
    return rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
}

/**
 * Extracts a clean, single-line text snippet from an email body for list views.
 * Removes attachment cards and HTML tags, normalizing whitespace.
 */
export function formatEmailSnippet(body?: string): string {
  if (!body) return '';

  return body
    .replace(/<div[\s\S]*?(?:Attached Documents|📎)[\s\S]*?<\/div>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
