import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPending, pendingFilters, pendingCSV, DEBT_STATUSES } from '../lib/pending.mjs';
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
  assert.deepEqual(report.rows.filter(row => row.count).map(row => row.name), ['ANA ÁLVAREZ', 'BRUNO PÉREZ', 'DANIEL EXTERNO']);
  assert.deepEqual(report.summary, { people: 3, tickets: 3, prepaid: 1, due: 42.5, unpickedPeople: 1, unpicked: 1, unpickedDue: 17.25, noShowPeople: 0, noShow: 0 });
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
  const numbers = buildPending(data).rows.flatMap(row => row.tickets.filter(ticket => DEBT_STATUSES.includes(ticket.status)).map(ticket => ticket.number));
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

test('Deudores and Estadísticas agree: picked-up debt is part of the statistics amount owed', async () => {
  const { buildAnalytics } = await import('../lib/analytics.mjs');
  const { fixedFilters } = await import('./fixtures/analytics.mjs');
  const source = analyticsFixture();
  const stats = buildAnalytics(source, fixedFilters).summary;
  const pending = buildPending(source).summary;
  assert.equal(stats.duePrepaid, pending.due - 12.5); // d1 (S/ 12.50) está recogido sin pago registrado
  const unpickedUnpaid = source.tickets.filter(t => !t.deleted_at && !t.is_available && !t.is_paid && !t.is_picked_up && (t.student_id || t.is_extra)).reduce((sum, t) => sum + t.unit_price, 0);
  assert.equal(stats.due, pending.due + unpickedUnpaid);
});

test('No recogió: tickets marked as no-show leave the debt in Deudores and Estadísticas but stay listed for undo', async () => {
  const { buildAnalytics } = await import('../lib/analytics.mjs');
  const { fixedFilters } = await import('./fixtures/analytics.mjs');
  const data = source();
  const before = buildAnalytics(data, fixedFilters).summary;
  // DANIEL no se presentó (su entrega se anula) y el ticket extra tampoco se recogió.
  Object.assign(data.tickets.find(ticket => ticket.id === 'd1'), { is_picked_up: false, no_show_at: '2026-11-21T10:00:00Z', no_show_by_email: 'one@example.test' });
  Object.assign(data.tickets.find(ticket => ticket.id === 'extra'), { no_show_at: '2026-11-21T10:00:00Z' });
  const report = buildPending(data);
  assert.equal(report.summary.due, 30); assert.equal(report.summary.people, 2);
  assert.equal(report.summary.noShow, 2); assert.equal(report.summary.unpicked, 0); assert.equal(report.summary.unpickedDue, 0);
  const daniel = report.rows.find(row => row.id === 'd');
  assert.deepEqual(daniel.tickets.map(ticket => [ticket.status, ticket.noShowBy]), [['no_show', 'one@example.test']]);
  assert.equal(daniel.due, 0); assert.equal(daniel.count, 0);
  const after = buildAnalytics(data, fixedFilters).summary;
  assert.equal(after.noShow, 2); assert.equal(after.due, before.due - 12.5 - 17.25);
  assert.equal(after.pendingPayment, before.pendingPayment - 2); assert.equal(after.pendingPickup, before.pendingPickup - 1);
  assert.equal(after.tickets, before.tickets);
  assert.match(pendingCSV(report), /"No recogió \(no se cobra\)","2"/);
});
