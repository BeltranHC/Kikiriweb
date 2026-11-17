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

test('Picked-up tickets that are unpaid or were delivered as Prepagado are listed, grouped by participant', () => {
  const report = buildPending(source());
  assert.deepEqual(report.rows.map(row => row.name), ['ANA ÁLVAREZ', 'BRUNO PÉREZ', 'DANIEL EXTERNO']);
  assert.deepEqual(report.summary, { people: 3, tickets: 3, prepaid: 1, due: 42.5 });
  const bruno = report.rows[1];
  assert.deepEqual(bruno.tickets.map(ticket => [ticket.number, ticket.status, ticket.price]), [[4, 'prepaid', 15]]);
  assert.equal(bruno.prepaid, 1); assert.equal(bruno.pickedAt, '2026-11-11T18:00:00Z');
  const ana = report.rows[0];
  assert.deepEqual(ana.tickets.map(ticket => ticket.number), [2]);
  assert.equal(ana.assigned, 2); assert.equal(ana.due, 15);
  assert.equal(ana.pickedAt, '2026-11-11T20:00:00Z'); assert.deepEqual(ana.deliveredBy, ['two@example.test']);
  assert.equal(ana.tickets[0].status, 'unpaid'); assert.equal(ana.prepaid, 0);
  assert.equal(report.rows[2].pickedAt, null); assert.deepEqual(report.rows[2].deliveredBy, []);
});

test('Cash or Yape payments, prepaid tickets not yet picked up, deleted, released and archived tickets never appear', () => {
  const data = source();
  data.tickets.find(ticket => ticket.id === 'f1').is_picked_up = true;
  data.tickets.find(ticket => ticket.id === 'released').is_picked_up = true;
  data.tickets.find(ticket => ticket.id === 'orphan').is_picked_up = true;
  data.tickets.find(ticket => ticket.id === 'c1').payment_method = 'prepaid|old@example.test';
  const numbers = buildPending(data).rows.flatMap(row => row.tickets.map(ticket => ticket.number));
  assert.deepEqual(numbers.sort(), [2, 4, 6]);
});

test('Extra tickets and group filters are respected', () => {
  const data = source();
  data.tickets.find(ticket => ticket.id === 'extra').is_picked_up = true;
  assert.equal(buildPending(data).rows.find(row => row.id === 'extras').due, 17.25);
  assert.deepEqual(buildPending(data, { group: 'external' }).rows.map(row => row.id), ['d']);
  assert.equal(buildPending(data, { group: 'semester:2' }).summary.prepaid, 1);
  assert.equal(buildPending(data, { group: 'semester:11' }).summary.people, 0);
  assert.throws(() => pendingFilters(new URLSearchParams({ group: 'bad' })));
  assert.deepEqual(pendingFilters(new URLSearchParams()), { group: 'all' });
});

test('CSV lists debtors and protects spreadsheet formulas', () => {
  const data = source(); data.students[0].name = '=HYPERLINK("x")';
  const csv = pendingCSV(buildPending(data));
  assert.match(csv, /'=HYPERLINK/); assert.match(csv, /DANIEL EXTERNO/); assert.match(csv, /"Por cobrar","42.5"/); assert.match(csv, /"Entregados como Prepagado","1"/);
});
