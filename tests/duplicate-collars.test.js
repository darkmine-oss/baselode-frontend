import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { collarsFromStandardRows } from '../src/lib/projectCoordinates.js';

const first = { hole_id: 'A', latitude: -25.5, longitude: 119.3,
  max_depth: 448, hole_type: 'DD', _collar_id: '1', source_table: 'dbo_collar', source_row_index: 0 };

test('matching duplicates keep the first collar, preserve order and emit one visible warning', () => {
  const warnings = [];
  const rows = [first, { ...first, hole_id: 'B' },
    { ...first, _collar_id: '2', source_row_index: 2 },
    { ...first, _collar_id: '3', source_row_index: 3 }];
  const before = structuredClone(rows);
  const collars = collarsFromStandardRows(rows, { onWarning: w => warnings.push(w) });
  assert.deepEqual(collars, collarsFromStandardRows(rows.slice(0, 2)));
  assert.deepEqual(rows, before);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Loaded 2 collars\. Skipped 2 duplicate collar records/);
  assert.match(warnings[0], /kept the first record.*: A\./);
});

test('CSV and row inputs use the same comparison, including numeric formatting and empty values', () => {
  const rows = [first, { ...first, latitude: '-25.500', max_depth: '448.0', elevation: '', _collar_id: '2' }];
  for (const input of [rows, Papa.parse(Papa.unparse(rows), { header: true }).data]) {
    const warnings = [];
    assert.equal(collarsFromStandardRows(input, {
      onWarning: w => warnings.push(w),
    }).length, 1);
    assert.equal(warnings.length, 1);
  }
});

test('conflicting collar attributes remain fatal and identify the field', () => {
  for (const [field, value] of Object.entries({ latitude: -26, longitude: 120, elevation: 100,
    max_depth: 500, hole_type: 'RC', project_id: 'other', report_number: 'other', custom: 'different' })) {
    const warnings = [];
    assert.throws(() => collarsFromStandardRows([first, { ...first, [field]: value }], {
      onWarning: w => warnings.push(w),
    }), new RegExp(`Duplicate collar hole ID: A.*conflicting.*${field}`));
    assert.deepEqual(warnings, []);
  }
});

test('unique inputs produce no warnings and matching local-grid duplicates load', () => {
  const warnings = [];
  collarsFromStandardRows([first], { onWarning: w => warnings.push(w) });
  assert.deepEqual(warnings, []);
  assert.equal(collarsFromStandardRows([{ hole_id: 'L', easting: 0, northing: 10 },
    { hole_id: 'L', easting: '0.0', northing: 10 }]).length, 1);
});
