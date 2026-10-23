import Papa from 'papaparse';

export interface ParsedLeadsResult {
  validEmails: string[];
  duplicateCount: number;
  invalidRows: Array<{ row: number; value: string; reason: string }>;
  totalRows: number;
  previewRows: Array<Record<string, string>>;
}

export type LeadParseResult = ParsedLeadsResult;

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Robustly parses CSV, TSV, or plain-text file content into validated recipient leads.
 */
export function parseLeadsContent(content: string): ParsedLeadsResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      validEmails: [],
      duplicateCount: 0,
      invalidRows: [],
      totalRows: 0,
      previewRows: []
    };
  }

  // Detect if plain newline or space/comma separated text
  const isPlainList = !trimmed.includes(',') && !trimmed.includes('\t');

  if (isPlainList) {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const validEmails: string[] = [];
    const seen = new Set<string>();
    let duplicateCount = 0;
    const invalidRows: Array<{ row: number; value: string; reason: string }> = [];

    lines.forEach((line, index) => {
      const email = line.toLowerCase();
      if (!EMAIL_REGEX.test(email)) {
        invalidRows.push({ row: index + 1, value: line, reason: 'Invalid email syntax' });
        return;
      }
      if (seen.has(email)) {
        duplicateCount++;
        return;
      }
      seen.add(email);
      validEmails.push(email);
    });

    return {
      validEmails,
      duplicateCount,
      invalidRows,
      totalRows: lines.length,
      previewRows: validEmails.slice(0, 10).map((email) => ({ email }))
    };
  }

  // Parse structured CSV/TSV with PapaParse
  const parseResult = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase()
  });

  const rows = parseResult.data;
  if (!rows || rows.length === 0) {
    return {
      validEmails: [],
      duplicateCount: 0,
      invalidRows: [],
      totalRows: 0,
      previewRows: []
    };
  }

  // Find candidate email column header
  const headers = Object.keys(rows[0] || {});
  let emailHeader: string | undefined = headers.find(
    (h) => h === 'email' || h === 'recipient' || h === 'lead_email' || h === 'email_address' || h === 'to'
  );

  // Fallback: look for the first column that contains email-like values
  if (!emailHeader) {
    for (const h of headers) {
      const sampleValue = rows[0]?.[h];
      if (sampleValue && EMAIL_REGEX.test(sampleValue.trim().toLowerCase())) {
        emailHeader = h;
        break;
      }
    }
  }

  const validEmails: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  const invalidRows: Array<{ row: number; value: string; reason: string }> = [];

  rows.forEach((row, index) => {
    let rawEmail = emailHeader ? row[emailHeader] : '';

    // If still not identified, search across all columns in this row
    if (!rawEmail) {
      for (const key of Object.keys(row)) {
        const val = row[key];
        if (val && EMAIL_REGEX.test(val.trim().toLowerCase())) {
          rawEmail = val;
          break;
        }
      }
    }

    if (!rawEmail || !rawEmail.trim()) {
      invalidRows.push({ row: index + 2, value: '(empty)', reason: 'Missing email value' });
      return;
    }

    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      invalidRows.push({ row: index + 2, value: rawEmail, reason: 'Invalid email syntax' });
      return;
    }

    if (seen.has(email)) {
      duplicateCount++;
      return;
    }

    seen.add(email);
    validEmails.push(email);
  });

  return {
    validEmails,
    duplicateCount,
    invalidRows,
    totalRows: rows.length,
    previewRows: rows.slice(0, 10)
  };
}

/**
 * Parses a File object (CSV or TXT) via HTML FileReader
 */
export async function parseLeadsFile(file: File): Promise<ParsedLeadsResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = (reader.result as string) || '';
        resolve(parseLeadsContent(text));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Parses raw text with comma, newline, or space separated leads
 */
export function parseLeadsText(text: string): ParsedLeadsResult {
  // If user entered comma or space separated emails, convert to newline
  const formatted = text.replace(/[,; ]+/g, '\n');
  return parseLeadsContent(formatted);
}
