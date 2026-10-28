import { test, expect } from '@playwright/test';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
async function fixtures(page) {
  const state = { expired: false, calls: [], slowSearch: false };
  const students = Array.from({ length: 35 }, (_, i) => ({
    id: uuid(i + 1), name: ['María Pérez', 'Andrés Salazar', 'Camila Torres', 'Diego Mendoza', 'Elena Vargas', 'Fernando Rojas'][i] || `Estudiante Demo ${i + 1}`,
    code: `2026-${String(i + 1).padStart(3, '0')}`, dni: String(12345678 + i),
    tickets: Array.from({ length: 4 }, (_, j) => ({ id: uuid(1000 + i * 4 + j), ticket_number: i * 4 + j + 1, is_picked_up: j === 3, unit_price: 15, movement_id: j === 3 ? uuid(5000 + i) : null })),
  }));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      if (url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'password') {
        state.expired = false;
        const now = Math.floor(Date.now() / 1000);
        const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: uuid(999), email: 'caja@example.test', aud: 'authenticated', exp: now + 3600, iat: now })).toString('base64url'), 'test-signature'].join('.');
        await route.fulfill({ json: { access_token: token, token_type: 'bearer', refresh_token: 'fixture-refresh-token', expires_in: 3600,
          user: { id: uuid(999), aud: 'authenticated', role: 'authenticated', email: 'caja@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() } } });
      } else if (url.pathname.endsWith('/auth/v1/token')) {
        await route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Expired fixture session' } });
      } else await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    state.calls.push({ path: url.pathname, query: url.searchParams.get('q'), page: url.searchParams.get('page') });
    if (state.expired) { await route.fulfill({ status: 401, json: { error: 'Debes iniciar sesión' } }); return; }
    if (url.pathname === '/api/stats') {
      await route.fulfill({ json: { totalTickets: 549, pickedUp: 273, pending: 276, totalStudents: 35, extraTickets: 20, collectedNow: 315, collectedCash: 195, collectedYape: 120 } });
    } else if (url.pathname === '/api/students') {
      const term = (url.searchParams.get('q') || '').toLowerCase();
      const filtered = students.filter(student => student.name.toLowerCase().includes(term) || student.code.includes(term));
      const number = Number(url.searchParams.get('page') || 1);
      if (state.slowSearch && term === 'mar') await new Promise(resolve => setTimeout(resolve, 700));
      try { await route.fulfill({ json: { students: filtered.slice((number - 1) * 30, number * 30), total: filtered.length, page: number, pageSize: 30, hasMore: number * 30 < filtered.length } }); } catch { /* The browser can cancel obsolete searches. */ }
    } else if (url.pathname === '/api/movements') {
      await route.fulfill({ json: [{ id: uuid(5001), kind: 'pickup', created_at: '2026-10-27T15:00:00Z', actor_email: 'caja@example.test', payment_method: 'en_momento_efectivo', ticket_ids: [uuid(1000)], activeTicketIds: [uuid(1000)], ticket_snapshots: [{ id: uuid(1000), ticket_number: 1, student_name: 'María Pérez', unit_price: 15 }] }] });
    } else if (url.pathname === '/api/tickets') await route.fulfill({ json: [] });
    else if (url.pathname === '/api/export') await route.fulfill({ contentType: 'text/csv', body: 'Ticket,Estudiante\n1,Demo\n' });
    else await route.fulfill({ status: 404, json: { error: 'Unknown test endpoint' } });
  });
  return state;
}
const searchInput = page => page.getByRole('searchbox', { name: 'Buscar estudiantes' });
async function searchMaria(page) {
  const search = searchInput(page); await search.fill('María');
  await expect(page.getByRole('button', { name: /María Pérez/ })).toBeVisible();
  await expect(page.getByText('1 estudiantes', { exact: true }).first()).toBeVisible();
  return search;
}

test('Light design ignores the previous dark preference and renders desktop and login previews', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikiriweb-theme', 'dark'));
  await fixtures(page); await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Control de entregas' })).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 251)');
  await expect(page.getByRole('region', { name: 'Resumen de entregas' })).toBeVisible();
  await expect(page.getByRole('button', { name: /María Pérez/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-preview/dashboard-desktop.png' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Correo electrónico', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-preview/login-desktop.png' });
});

test('Automatic updates pause while typing and resume without clearing text, focus or navigating', async ({ page }) => {
  const state = await fixtures(page); await page.clock.install(); await page.goto('/dashboard');
  await searchMaria(page); await expect(page.getByText('Actualización en pausa')).toBeVisible();
  const before = state.calls.filter(call => call.path === '/api/students').length;
  await page.clock.fastForward(61000);
  await expect(searchInput(page)).toHaveValue('María'); await expect(searchInput(page)).toBeFocused();
  expect(state.calls.filter(call => call.path === '/api/students').length).toBe(before);
  await searchInput(page).blur();
  await page.clock.fastForward(31000);
  await expect.poll(() => state.calls.filter(call => call.path === '/api/students').length).toBeGreaterThan(before);
  await expect(searchInput(page)).toHaveValue('María'); await expect(page).toHaveURL(/\/dashboard$/);
});

test('Manual and automatic updates preserve expanded tickets and payment selections', async ({ page }) => {
  const state = await fixtures(page); await page.clock.install(); await page.goto('/dashboard');
  await searchMaria(page); await page.getByRole('button', { name: /María Pérez/ }).click();
  const ticket = page.getByRole('button', { name: '0001', exact: true });
  await ticket.click(); await page.getByRole('button', { name: 'Siguiente', exact: true }).first().click();
  const yape = page.getByRole('button', { name: /Yape S\/ 15/ }); await yape.click();
  await expect(yape).toHaveAttribute('aria-pressed', 'true');
  const before = state.calls.filter(call => call.path === '/api/students').length;
  await page.clock.fastForward(61000);
  expect(state.calls.filter(call => call.path === '/api/students').length).toBe(before);
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect.poll(() => state.calls.filter(call => call.path === '/api/students').length).toBeGreaterThan(before);
  await expect(ticket).toHaveAttribute('aria-pressed', 'true'); await expect(yape).toHaveAttribute('aria-pressed', 'true');
  await expect(searchInput(page)).toHaveValue('María');
});

test('A reload restores the query before issuing the first student request', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard'); await searchMaria(page);
  const before = state.calls.length; await page.reload();
  await expect(searchInput(page)).toHaveValue('María');
  await expect(page.getByRole('button', { name: /María Pérez/ })).toBeVisible();
  const after = state.calls.slice(before).filter(call => call.path === '/api/students');
  expect(after.length).toBeGreaterThan(0); expect(after.every(call => call.query === 'María')).toBe(true);
});

test('Pagination and different screen searches survive navigation independently', async ({ page }) => {
  await fixtures(page); await page.goto('/dashboard'); await searchMaria(page);
  await page.getByRole('link', { name: 'Estudiantes', exact: true }).click();
  await expect(page).toHaveURL(/\/students$/); await expect(searchInput(page)).toBeVisible();
  await searchInput(page).fill('Demo'); await expect(page.getByText('29 estudiantes', { exact: false }).first()).toBeVisible();
  await page.goto('/dashboard'); await expect(searchInput(page)).toHaveValue('María');
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText(/Página 2/)).toBeVisible(); await page.reload();
  await expect(page.getByText(/Página 2/)).toBeVisible();
  await page.goto('/students'); await expect(searchInput(page)).toHaveValue('Demo');
});

test('Expired sessions recover inside the same screen without losing the search or selected ticket', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard'); await searchMaria(page);
  await page.getByRole('button', { name: /María Pérez/ }).click();
  const ticket = page.getByRole('button', { name: '0001', exact: true }); await ticket.click();
  state.expired = true; await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Continúa donde estabas' }); await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/); await expect(searchInput(page)).toHaveValue('María');
  await expect(ticket).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('Correo electrónico').fill('caja@example.test'); await dialog.getByLabel('Contraseña', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: 'Continuar en esta pantalla' }).click();
  await expect(dialog).not.toBeVisible(); await expect(searchInput(page)).toHaveValue('María');
  await expect(ticket).toHaveAttribute('aria-pressed', 'true'); await expect(page).toHaveURL(/\/dashboard$/);
});

test('A slower old search cannot replace newer results', async ({ page }) => {
  const state = await fixtures(page); state.slowSearch = true; await page.goto('/dashboard');
  await searchInput(page).fill('Mar');
  await expect.poll(() => state.calls.some(call => call.query === 'Mar')).toBe(true);
  await searchInput(page).fill('Andrés');
  await expect(page.getByRole('button', { name: /Andrés Salazar/ })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(searchInput(page)).toHaveValue('Andrés');
  await expect(page.getByRole('button', { name: /María Pérez/ })).not.toBeVisible();
});

test('Mobile layouts stay light and fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page); await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /María Pérez/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-preview/dashboard-mobile.png' });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-preview/login-mobile.png', fullPage: true });
});
