import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPending, pendingFilters, pendingCSV } from '../lib/pending.mjs';
import { analyticsFixture } from './fixtures/analytics.mjs';

const source = () => {
  const data = analyticsFixture();
  // ANA recoge su segundo ticket sin pagar; el externo DANIEL ya figura recogido sin pago.
  data.tickets.find(ticket => ticket.id === 'a2').is_picked_up = true;
  data.movements.push({ id: 'm4', kind: 'pickup', created_at: '2026-11-11T20:00:00Z', actor_email: 'two@example.test', items: [{ id: 'a2', student_id: 'a' }] },
    { id: 'm5', kind: 'undo', created_at: '2026-11-11T21:00:00Z', actor_email: 'one@example.test', items: [{ id: 'a2', student_id: 'a' }] });
  return data;
};

test('Only active tickets that were picked up and remain unpaid are listed, grouped by participant', () => {
  const report = buildPending(source());
  assert.deepEqual(report.rows.map(row => row.name), ['ANA ÁLVAREZ', 'DANIEL EXTERNO']);
  assert.deepEqual(report.summary, { people: 2, tickets: 2, due: 27.5 });
  const ana = report.rows[0];
  assert.deepEqual(ana.tickets.map(ticket => ticket.number), [2]);
  assert.equal(ana.assigned, 2); assert.equal(ana.due, 15);
  assert.equal(ana.pickedAt, '2026-11-11T20:00:00Z'); assert.deepEqual(ana.deliveredBy, ['two@example.test']);
  assert.equal(report.rows[1].pickedAt, null); assert.deepEqual(report.rows[1].deliveredBy, []);
});

test('Prepaid, paid, not picked up, deleted, released and archived tickets never appear', () => {
  const data = source();
  data.tickets.find(ticket => ticket.id === 'f1').is_picked_up = true;
  data.tickets.find(ticket => ticket.id === 'released').is_picked_up = true;
  data.tickets.find(ticket => ticket.id === 'orphan').is_picked_up = true;
  const numbers = buildPending(data).rows.flatMap(row => row.tickets.map(ticket => ticket.number));
  assert.deepEqual(numbers.sort(), [2, 6]);
});

test('Extra tickets and group filters are respected', () => {
  const data = source();
  data.tickets.find(ticket => ticket.id === 'extra').is_picked_up = true;
  assert.equal(buildPending(data).rows.find(row => row.id === 'extras').due, 17.25);
  assert.deepEqual(buildPending(data, { group: 'external' }).rows.map(row => row.id), ['d']);
  assert.equal(buildPending(data, { group: 'semester:2' }).summary.people, 0);
  assert.throws(() => pendingFilters(new URLSearchParams({ group: 'bad' })));
  assert.deepEqual(pendingFilters(new URLSearchParams()), { group: 'all' });
});

test('CSV lists debtors and protects spreadsheet formulas', () => {
  const data = source(); data.students[0].name = '=HYPERLINK("x")';
  const csv = pendingCSV(buildPending(data));
  assert.match(csv, /'=HYPERLINK/); assert.match(csv, /DANIEL EXTERNO/); assert.match(csv, /"Por cobrar","27.5"/);
});
