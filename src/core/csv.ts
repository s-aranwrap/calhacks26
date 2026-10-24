/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, CRLF/LF line endings and a UTF-8 BOM. That covers
 * spreadsheet exports without pulling in a dependency.
 */

export interface CsvParseResult {
  headers: string[];
  /** Each row as header → raw string value. Blank lines are skipped. */
  rows: { line: number; values: Record<string, string> }[];
  errors: { line: number; message: string }[];
}

export function parseCsv(text: string): CsvParseResult {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; fields: string[] }[] = [];
  const errors: CsvParseResult['errors'] = [];

  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldWasQuoted = false;

  const endField = () => {
    fields.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (!(fields.length === 1 && fields[0] === '')) records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim() === '') {
        inQuotes = true;
        fieldWasQuoted = true;
        field = '';
      } else {
        field += ch; // stray quote inside an unquoted field: keep it literally
      }
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) errors.push({ line: recordLine, message: 'unterminated quoted field' });
  if (field !== '' || fields.length) endRecord();

  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) return { headers: [], rows: [], errors: [...errors, { line: 1, message: 'file is empty' }] };

  const headers = headerRecord.fields.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: CsvParseResult['rows'] = [];
  for (const record of dataRecords) {
    if (record.fields.length > headers.length && record.fields.slice(headers.length).some((f) => f !== '')) {
      errors.push({
        line: record.line,
        message: `row has ${record.fields.length} columns but the header has ${headers.length}`,
      });
      continue;
    }
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = record.fields[index];
      if (header && value !== undefined && value !== '') values[header] = value;
    });
    rows.push({ line: record.line, values });
  }
  return { headers, rows, errors };
}
