import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { analyticsFixture } from '../tests/fixtures/analytics.mjs';
import { buildPending, pendingFilters, ticketStatus } from '../lib/pending.mjs';

async function fixture(page) {
  await page.clock.setFixedTime(new Date('2026-11-12T18:00:00Z'));
  const source = analyticsFixture();
  source.tickets.find(ticket => ticket.id === 'a2').is_picked_up = true;
  source.movements.push({ id: 'm4', kind: 'pickup', created_at: '2026-11-11T20:00:00Z', actor_email: 'two@example.test', items: [{ id: 'a2', student_id: 'a' }] });
  const state = { source, calls: [], posts: [] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    state.calls.push({ path: url.pathname, method: route.request().method() });
    if (url.pathname === '/api/pending') { await route.fulfill({ json: buildPending(state.source, pendingFilters(url.searchParams), new Date('2026-11-12T18:00:00Z')) }); return; }
    if (url.pathname === '/api/pending/tickets' && route.request().method() === 'GET') {
      const tickets = state.source.tickets.filter(ticket => ticket.student_id === url.searchParams.get('studentId') && !ticket.deleted_at && !ticket.is_available)
        .map(ticket => ({ ...ticket, assignment_updated_at: '2026-11-12T10:00:00.000Z', status: ticketStatus(ticket) })).filter(ticket => ticket.status);
      await route.fulfill({ json: { studentId: url.searchParams.get('studentId'), tickets } }); return;
    }
    if (url.pathname === '/api/pending/tickets' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); state.posts.push(body);
      for (const item of body.tickets) Object.assign(state.source.tickets.find(ticket => ticket.id === item.id), body.noShow ? { is_picked_up: false, is_paid: false, payment_method: null, no_show_at: '2026-11-12T18:00:00Z', no_show_by_email: 'one@example.test' } : { no_show_at: null, no_show_by_email: null });
      await route.fulfill({ json: { studentId: body.studentId, changed: body.tickets.length, noShow: body.noShow } }); return;
    }
    await route.fulfill({ json: { students: [], total: 0, hasMore: false } });
  });
  return state;
}
const metric = (page, label) => page.getByRole('region', { name: 'Resumen de pagos pendientes' }).getByRole('article', { name: label, exact: true }).locator('strong');

test('Deudores lists who picked up without paying, filters, exports and never writes', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/pending');
  await expect(page.getByRole('heading', { name: 'Recogieron sin pagar', exact: true })).toBeVisible();
  await expect(metric(page, 'Participantes que deben')).toHaveText('3');
  await expect(metric(page, 'Polladas recogidas sin pagar')).toHaveText('3');
  await expect(metric(page, 'Monto por cobrar')).toContainText('42.50');
  const table = page.getByRole('table');
  await expect(table).toContainText('ANA ÁLVAREZ'); await expect(table).toContainText('#0002'); await expect(table).toContainText('two@example.test');
  await expect(table).toContainText('DANIEL EXTERNO'); await expect(table).toContainText('BRUNO PÉREZ'); await expect(table).toContainText('1 como Prepagado'); await expect(table).not.toContainText('CARMEN');
  await page.screenshot({ path: 'artifacts/ui-preview/pending-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('Buscar participante, código o ticket').fill('daniel');
  await expect(table).not.toContainText('ANA');
  await page.getByLabel('Buscar participante, código o ticket').fill('');
  await page.getByLabel('Situación', { exact: true }).selectOption('prepaid');
  await expect(table).toContainText('BRUNO'); await expect(table).not.toContainText('DANIEL');
  await page.getByLabel('Situación', { exact: true }).selectOption('debt');
  await page.getByLabel('Grupo', { exact: true }).selectOption('semester:1');
  await expect(metric(page, 'Participantes que deben')).toHaveText('1'); await expect(table).not.toContainText('DANIEL');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar lista' }).click();
  const text = await readFile(await (await download).path(), 'utf8');
  expect(text).toContain('ANA ÁLVAREZ'); expect(text).toContain('two@example.test');
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  await expect(table.getByRole('button', { name: 'Registrar pago' })).toBeVisible();
});

test('No recogió removes a participant from the debt, lists them apart and can be undone', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/pending');
  await expect(metric(page, 'Monto por cobrar')).toContainText('42.50');
  await expect(metric(page, 'Sin recoger')).toHaveText('1');
  const table = page.getByRole('table');
  const daniel = table.getByRole('row').filter({ hasText: 'DANIEL EXTERNO' });
  await daniel.getByRole('button', { name: 'No recogió' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marcar como No recogió' });
  await expect(dialog).toContainText('Deja de cobrarse: S/ 12.50');
  await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Revisar No recogió' }).click();
  await expect(dialog.getByRole('alert')).toContainText('no recogió 1 ticket');
  await dialog.getByRole('button', { name: 'Confirmar No recogió' }).click();
  await expect(dialog).toBeHidden();
  expect(state.posts).toEqual([{ studentId: 'd', tickets: [{ id: 'd1', updated_at: '2026-11-12T10:00:00.000Z' }], noShow: true }]);
  await expect(metric(page, 'Monto por cobrar')).toContainText('30.00');
  await expect(metric(page, 'Participantes que deben')).toHaveText('2');
  await expect(table).not.toContainText('DANIEL');
  await expect(metric(page, 'Sin recoger')).toHaveText('1');
  await expect(page.getByRole('article', { name: 'Sin recoger' })).toContainText('1 marcados No recogió');
  await page.getByLabel('Situación', { exact: true }).selectOption('no_show');
  await expect(table).toContainText('DANIEL EXTERNO'); await expect(table).toContainText('No se cobra'); await expect(table).toContainText('one@example.test');
  await page.screenshot({ path: 'artifacts/ui-preview/pending-no-show.png', fullPage: true, animations: 'disabled' });
  await table.getByRole('button', { name: 'Deshacer No recogió' }).click();
  const undo = page.getByRole('dialog', { name: 'Deshacer No recogió' });
  await undo.getByRole('button', { name: 'Revisar' }).click();
  await undo.getByRole('button', { name: 'Confirmar' }).click();
  await expect(undo).toBeHidden();
  expect(state.posts.at(-1).noShow).toBe(false);
  await expect(page.getByText('Nadie figura como No recogió.')).toBeVisible();
});

test('Deudores fits a phone without horizontal page scroll and shows the empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await page.goto('/pending');
  await expect(metric(page, 'Participantes que deben')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Deudores' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'artifacts/ui-preview/pending-mobile.png', fullPage: true, animations: 'disabled' });
  for (const ticket of state.source.tickets) { ticket.is_paid = true; ticket.payment_method = 'en_momento_efectivo|one@example.test'; }
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText('Nadie ha recogido su pollada con el pago pendiente.')).toBeVisible();
});
