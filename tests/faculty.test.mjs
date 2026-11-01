import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFacultyCSV, decodeFacultyCSV, facultyStudentInput, facultyEditInput, parseTicketNumbers, allocationInput, semesterNumber, semesterLabel, PROMOTION_SEMESTER } from '../lib/faculty.mjs';

const id = '11111111-1111-4111-8111-111111111111';
test('Faculty CSV preserves string codes, joins surnames, and sorts semesters numerically', () => {
  const rows = parseFacultyCSV('\uFEFFCódigo;Nombres;Apellidos;Escuela Profesional;Semestre\r\n00123;José;Pérez;FINESI;X\r\n100001;Ana;Zapata;FIENSI;II\r\n100002;Luis;Álvarez;FINESI;II');
  assert.deepEqual(rows.map(row => row.code), ['100002','100001','00123']);
  assert.equal(rows[2].name, 'Pérez José'); assert.equal(rows[2].semester, 10);
  assert.equal(rows[1].school, 'FIENSI');
});
test('Faculty CSV supports UTF-8 and Windows-1252 without losing accented letters', () => {
  assert.equal(decodeFacultyCSV(new TextEncoder().encode('Pérez')), 'Pérez');
  assert.equal(decodeFacultyCSV(Uint8Array.from([80,233,114,101,122])), 'Pérez');
});
test('Faculty import rejects missing fields, duplicate codes, invalid semesters and malformed CSV', () => {
  for (const input of ['nombre,semestre\nDemo,II', 'codigo,nombre,semestre\n12,A,II\n12,B,III', 'codigo,nombre,semestre\n12,A,XI', 'codigo,nombre,semestre\n12,"A,II']) assert.throws(() => parseFacultyCSV(input));
});
test('Student editing validates identity and requires an optimistic update version', () => {
  assert.deepEqual(facultyStudentInput({ name: '  Ana  Demo ', code: 'ab-012', semester: 'VI', school: ' FINESI ' }), { name: 'Ana Demo', code: 'AB-012', semester: 6, school: 'FINESI' });
  assert.equal(semesterNumber(''), null);
  assert.throws(() => facultyStudentInput({ name: 'Demo', code: '' }));
  assert.throws(() => facultyEditInput({ id, name: 'Demo', code: '00123' }));
  assert.equal(facultyEditInput({ id, name: 'Demo', code: '00123', expectedUpdatedAt: '2026-10-31T12:00:00Z' }).id, id);
});
test('Assignment accepts a mix of individual numbers and ascending ranges', () => {
  assert.deepEqual(parseTicketNumbers('1052,1050; 1060-1063\n1070'), [1050,1052,1060,1061,1062,1063,1070]);
  assert.deepEqual(parseTicketNumbers(''), []);
  for (const value of ['1,1', '3-1', '1-2001', '0', '-1', '2x', '2147483648', '1-3,2']) assert.throws(() => parseTicketNumbers(value));
  assert.equal(parseTicketNumbers('1-2000').length, 2000);
  assert.throws(() => allocationInput({ studentId: id, ticketNumbers: [1,1] }));
  assert.throws(() => allocationInput({ studentId: 'bad', ticketNumbers: [1] }));
  assert.throws(() => allocationInput({ studentId: id, ticketNumbers: [] }));
});


test('Promotion is distinct from unknown semester and the ten academic semesters', () => {
  assert.equal(semesterNumber('Promoción'), PROMOTION_SEMESTER);
  assert.equal(semesterNumber('promocion'), 11);
  assert.equal(semesterNumber('11'), 11);
  assert.equal(semesterLabel(11), 'Promoción');
  assert.equal(semesterLabel(null), 'Sin semestre');
  assert.equal(semesterLabel(10), 'X semestre');
  assert.throws(() => semesterNumber(12));
});


test('CSV can name the Promotion category explicitly and keeps academic ordering', () => {
  const rows=parseFacultyCSV('codigo,nombre,semestre\nP-01,Promoted,Promoción\nF-01,Faculty,X');
  assert.deepEqual(rows.map(row=>row.semester),[10,11]);
});
