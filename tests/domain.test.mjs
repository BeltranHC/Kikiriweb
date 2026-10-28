import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, csvCell } from '../lib/csv.mjs';
import { importRows, studentInput, pickupInput, ticketNumber } from '../lib/validation.mjs';
import { dayBounds, localDate, parsePayment, summarizePayments } from '../lib/domain.mjs';
import { fetchAll } from '../lib/pagination.mjs';
import { cashReport } from '../lib/report.mjs';
import { debounce } from '../lib/debounce.mjs';

const id = '11111111-1111-4111-8111-111111111111';
test('CSV: BOM, semicolons, Spanish header aliases and CRLF', () => {
  assert.deepEqual(parseCSV('\uFEFFNombres;Inicio;Fin\r\nDemo;1;2\r\n'), [{ nombre: 'Demo', ticket_inicio: '1', ticket_fin: '2' }]);
});
test('CSV: escaped quotes, commas and multiline fields', () => {
  assert.equal(parseCSV('nombre,tickets\n"Ana ""Demo"",\nPérez","1;2"')[0].nombre, 'Ana "Demo",\nPérez');
});
test('CSV rejects malformed fields and duplicate headers', () => {
  for (const input of ['nombre,tickets\n"Demo,1', 'nombre,tickets\nDemo,1,2', 'nombre,name\nA,B', 'nombre,tickets\n"Demo"x,1']) assert.throws(() => parseCSV(input));
});
test('CSV preserves optional code and DNI and detects duplicate tickets', () => {
  const rows = importRows(parseCSV('nombre,codigo,dni,tickets\nDemo,ABC,12345678,"1;2"'));
  assert.deepEqual(rows[0], { name: 'Demo', code: 'ABC', dni: '12345678', tickets: [1, 2] });
  assert.throws(() => importRows([{ nombre: 'A', tickets: '1;2' }, { nombre: 'B', tickets: '2' }]), /repetido/);
});
test('Ticket validation rejects partial numbers, negatives, huge ranges and incomplete ranges', () => {
  for (const value of ['1x', '', -1, 0, 1.5, null, 2147483648]) assert.throws(() => ticketNumber(value));
  for (const input of [{ name: ' ' }, { name: 'Demo', ticketStart: 1 }, { name: 'Demo', ticketStart: 5, ticketEnd: 2 }, { name: 'Demo', ticketStart: 1, ticketEnd: 2001 }]) assert.throws(() => studentInput(input));
});
test('Pickup validation requires a boolean, a known method and the original movement for undo', () => {
  assert.throws(() => pickupInput({ ticketIds: [id], isPickedUp: 'false' }));
  assert.throws(() => pickupInput({ ticketIds: [id], isPickedUp: true, paymentMethod: 'unknown' }));
  assert.throws(() => pickupInput({ ticketIds: [id], isPickedUp: false }));
  assert.equal(pickupInput({ ticketIds: [id], isPickedUp: false, expectedMovementId: id }).expectedMovementId, id);
});
test('Lima date changes at 05:00 UTC and boundaries exclude the next day', () => {
  assert.equal(localDate('2026-10-28T04:59:59Z'), '2026-10-27');
  assert.equal(localDate('2026-10-28T05:00:00Z'), '2026-10-28');
  assert.deepEqual(dayBounds('2026-10-27'), { day: '2026-10-27', start: '2026-10-27T05:00:00.000Z', end: '2026-10-28T05:00:00.000Z' });
  assert.throws(() => dayBounds('2026-02-30'));
});
test('Payment totals recognize legacy cash, current cash, Yape and historical prices', () => {
  const tickets = [{ payment_method: 'en_momento|a', unit_price: '15.00' }, { payment_method: 'en_momento_efectivo|b', unit_price: 18 }, { payment_method: 'en_momento_yape|c', unit_price: 20 }, { payment_method: 'previo|d', unit_price: 15 }];
  assert.deepEqual(summarizePayments(tickets), { cash: 33, yape: 20, total: 53 });
  assert.equal(parsePayment('en_momento|demo@example.test').method, 'en_momento_efectivo');
});
test('Export separates cash and Yape, quotes fields, and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('A "quoted" name'), '"A ""quoted"" name"');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  const csv = cashReport([
    { ticket_number: 1, payment_method: 'en_momento_efectivo|a', picked_up_at: '2026-10-27T15:00:00Z', students: { name: 'Demo "A"' } },
    { ticket_number: 2, payment_method: 'en_momento_yape|b', picked_up_at: '2026-10-27T15:00:00Z', students: { name: '=1+1' } },
  ], '2026-10-27');
  assert(csv.includes('"Efectivo Recaudado (S/)","15"'));
  assert(csv.includes('"Yape Recaudado (S/)","15"'));
  assert(csv.includes('"Total Recaudado (S/)","30"'));
  assert(csv.includes('Demo ""A""'));
  assert(csv.includes("'=1+1"));
});
test('Pagination continues when the server caps responses below the requested size', async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await fetchAll(() => ({ range: async start => ({ data: rows.slice(start, start + 70), error: null }) }));
  assert.equal(result.length, 1201);
  assert.equal(new Set(result.map(row => row.id)).size, 1201);
});
test('Pagination propagates server errors instead of returning a partial success', async () => {
  await assert.rejects(fetchAll(() => ({ range: async () => ({ data: null, error: new Error('offline') }) })), /offline/);
});
test('Debounce cancellation prevents callbacks after clearing or unmounting', async () => {
  const calls = [];
  const search = debounce(value => calls.push(value), 10);
  search('old'); search.cancel();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(calls, []);
});
