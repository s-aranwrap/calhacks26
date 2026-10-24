import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { parseCsv } from '../../src/core/csv.ts';
import { detectFormat, importActivities, summarizeImport } from '../../src/core/importer.ts';
import { NOW } from '../helpers.ts';

const ctx = { now: NOW, defaultCurrency: 'USD' };

describe('CSV parser', () => {
  test('handles quotes, escaped quotes, embedded commas/newlines, CRLF and a BOM', () => {
    const text = '\uFEFFtitle,description\r\n"Quiz, night","She said ""hi""\nthen left"\r\nPlain,  padded  \r\n';
    const { headers, rows, errors } = parseCsv(text);
    assert.deepEqual(headers, ['title', 'description']);
    assert.deepEqual(errors, []);
    assert.deepEqual(rows[0]?.values, { title: 'Quiz, night', description: 'She said "hi"\nthen left' });
    assert.deepEqual(rows[1]?.values, { title: 'Plain', description: 'padded' });
    assert.equal(rows[1]?.line, 4, 'line numbers account for embedded newlines');
  });

  test('skips blank lines and reports rows with too many columns', () => {
    const { rows, errors } = parseCsv('title\nA\n\nB,extra\nC\n');
    assert.deepEqual(
      rows.map((r) => r.values.title),
      ['A', 'C'],
    );
    assert.deepEqual(errors, [{ line: 4, message: 'row has 2 columns but the header has 1' }]);
  });

  test('normalizes header names', () => {
    assert.deepEqual(parseCsv('Title, Start At \nx,y').headers, ['title', 'start_at']);
  });

  test('reports an unterminated quote', () => {
    assert.equal(parseCsv('title\n"broken').errors[0]?.message, 'unterminated quoted field');
  });
});

describe('importActivities', () => {
  test('imports valid rows, reports invalid rows with line numbers, merges duplicates', () => {
    const csv = [
      'title,category,price_min,source_url,start_at',
      'Pottery,arts,20,https://a.example/p,',
      ',arts,10,,',
      'Pottery again,arts,20,https://www.a.example/p/,',
      'Bad price,arts,-3,,',
      'Talk,learning,,,"2026-11-10T19:00:00Z"',
    ].join('\n');
    const report = importActivities(csv, 'csv', ctx);
    assert.equal(report.totalRows, 5);
    assert.equal(report.activities.length, 3);
    assert.deepEqual(
      report.invalid.map((i) => i.row),
      [3],
    );
    assert.ok(report.invalid[0]?.messages.includes('title is required'));
    assert.equal(report.duplicates.length, 1);
    assert.ok(report.warnings.some((w) => w.row === 5 && w.messages.some((m) => m.includes('price_min'))));
    assert.equal(report.activities.find((a) => a.title === 'Talk')?.kind, 'event');
    assert.equal(summarizeImport(report), '3 activities imported · 1 row skipped · 1 duplicate merged');
  });

  test('every imported record is marked with its source platform and unverified by default', () => {
    const report = importActivities('[{"title":"A"},{"title":"B","source_platform":"organizer"}]', 'json', ctx);
    assert.deepEqual(
      report.activities.map((a) => a.source.platform),
      ['json', 'organizer'],
    );
    assert.ok(report.activities.every((a) => a.verification.status === 'unverified'));
  });

  test('accepts { "activities": [...] } and rejects other JSON shapes', () => {
    assert.equal(importActivities('{"activities":[{"title":"A"}]}', 'json', ctx).activities.length, 1);
    assert.match(importActivities('{"items":[]}', 'json', ctx).invalid[0]?.messages[0] ?? '', /must be an array/);
    assert.match(importActivities('{oops', 'json', ctx).invalid[0]?.messages[0] ?? '', /invalid JSON/);
  });

  test('flags unknown columns so typos are visible', () => {
    const report = importActivities('title,catgory\nA,arts', 'csv', ctx);
    assert.deepEqual(report.unknownColumns, ['catgory']);
  });

  test('detects the format from the file name or content', () => {
    assert.equal(detectFormat('x.CSV', '[]'), 'csv');
    assert.equal(detectFormat(undefined, '  [{"title":"a"}]'), 'json');
    assert.equal(detectFormat('upload', 'title\nA'), 'csv');
  });

  for (const file of ['activities.sample.csv', 'activities.sample.json']) {
    test(`the documented sample file ${file} imports cleanly`, () => {
      const text = readFileSync(new URL(`../../data/samples/${file}`, import.meta.url), 'utf8');
      const report = importActivities(text, detectFormat(file, text), ctx);
      assert.deepEqual(report.invalid, []);
      assert.deepEqual(report.unknownColumns, []);
      assert.ok(report.activities.length >= 2);
    });
  }

  test('the CSV sample exercises verified, wall-clock and offset times correctly', () => {
    const text = readFileSync(new URL('../../data/samples/activities.sample.csv', import.meta.url), 'utf8');
    const { activities } = importActivities(text, 'csv', ctx);
    const quiz = activities.find((a) => a.id === 'sample-quiz-night');
    assert.equal(quiz?.startAt, '2026-11-18T19:30:00.000Z', 'London is on GMT in November');
    const ceramics = activities.find((a) => a.id === 'sample-ceramics');
    assert.equal(ceramics?.verification.status, 'verified');
    assert.equal(ceramics?.source.url, 'https://example.org/clayworks?utm_source=newsletter');
  });
});
