import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { analyticsFixture } from '../tests/fixtures/analytics.mjs';
import { buildPending, pendingFilters } from '../lib/pending.mjs';

async function fixture(page) {
  await page.clock.setFixedTime(new Date('2026-11-12T18:00:00Z'));
  const source = analyticsFixture();
  source.tickets.find(ticket => ticket.id === 'a2').is_picked_up = true;
  source.movements.push({ id: 'm4', kind: 'pickup', created_at: '2026-11-11T20:00:00Z', actor_email: 'two@example.test', items: [{ id: 'a2', student_id: 'a' }] });
  const state = { source, calls: [] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    state.calls.push({ path: url.pathname, method: route.request().method() });
    if (url.pathname === '/api/pending') { await route.fulfill({ json: buildPending(state.source, pendingFilters(url.searchParams), new Date('2026-11-12T18:00:00Z')) }); return; }
    await route.fulfill({ json: { students: [], total: 0, hasMore: false } });
  });
  return state;
}
const metric = (page, label) => page.getByRole('region', { name: 'Resumen de pagos pendientes' }).getByRole('article', { name: label, exact: true }).locator('strong');

test('Deudores lists who picked up without paying, filters, exports and never writes', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/pending');
  await expect(page.getByRole('heading', { name: 'Recogieron sin pagar', exact: true })).toBeVisible();
  await expect(metric(page, 'Participantes que deben')).toHaveText('2');
  await expect(metric(page, 'Polladas recogidas sin pagar')).toHaveText('2');
  await expect(metric(page, 'Monto por cobrar')).toContainText('27.50');
  const table = page.getByRole('table');
  await expect(table).toContainText('ANA ÁLVAREZ'); await expect(table).toContainText('#0002'); await expect(table).toContainText('two@example.test');
  await expect(table).toContainText('DANIEL EXTERNO'); await expect(table).not.toContainText('BRUNO');
  await page.screenshot({ path: 'artifacts/ui-preview/pending-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('Buscar participante, código o ticket').fill('daniel');
  await expect(table).not.toContainText('ANA');
  await page.getByLabel('Buscar participante, código o ticket').fill('');
  await page.getByLabel('Grupo', { exact: true }).selectOption('semester:1');
  await expect(metric(page, 'Participantes que deben')).toHaveText('1'); await expect(table).not.toContainText('DANIEL');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar lista' }).click();
  const text = await readFile(await (await download).path(), 'utf8');
  expect(text).toContain('ANA ÁLVAREZ'); expect(text).toContain('two@example.test');
  expect(state.calls.every(call => call.method === 'GET')).toBe(true);
  await table.getByRole('link', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('001');
});

test('Deudores fits a phone without horizontal page scroll and shows the empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await page.goto('/pending');
  await expect(metric(page, 'Participantes que deben')).toHaveText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Deudores' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'artifacts/ui-preview/pending-mobile.png', fullPage: true, animations: 'disabled' });
  for (const ticket of state.source.tickets) ticket.is_paid = true;
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText('Nadie ha recogido su pollada con el pago pendiente.')).toBeVisible();
});
