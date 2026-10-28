export const TICKET_PRICE = 15;
export const APP_TIME_ZONE = 'America/Lima';
export const PAYMENT_METHODS = ['en_momento_efectivo', 'en_momento_yape', 'previo'];

export function parsePayment(value = '') {
  const [raw, email = ''] = String(value || '').split('|');
  const method = raw === 'en_momento' ? 'en_momento_efectivo' : raw;
  return {
    method, email,
    isCash: method === 'en_momento_efectivo',
    isYape: method === 'en_momento_yape',
    label: ({ en_momento_efectivo: 'Efectivo', en_momento_yape: 'Yape', previo: 'Pre-venta' })[method] || 'Sin especificar',
  };
}

export function localDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

export function dayBounds(day = localDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
    throw new Error('Fecha inválida');
  }
  const start = new Date(`${day}T00:00:00-05:00`);
  return { day, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export function summarizePayments(tickets) {
  let cash = 0;
  let yape = 0;
  for (const ticket of tickets) {
    const payment = parsePayment(ticket.payment_method);
    const price = Number(ticket.unit_price ?? TICKET_PRICE);
    if (payment.isCash) cash += price;
    if (payment.isYape) yape += price;
  }
  cash = Math.round(cash * 100) / 100;
  yape = Math.round(yape * 100) / 100;
  return { cash, yape, total: Math.round((cash + yape) * 100) / 100 };
}
