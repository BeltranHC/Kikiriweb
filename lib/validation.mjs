import { PAYMENT_METHODS } from './domain.mjs';

export class ValidationError extends Error {}
export const MAX_TICKETS_PER_STUDENT = 2000;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_TICKETS = 10000;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new ValidationError('ID inválido');
  return value;
}

export function ticketNumber(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new ValidationError('Número de ticket inválido');
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isInteger(number) || number < 1 || number > 2147483647) throw new ValidationError('El ticket debe ser un entero positivo');
  return number;
}

function optionalText(value, maxLength, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new ValidationError(`${label} inválido`);
  return value.trim() || null;
}

export function studentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Datos inválidos');
  const name = optionalText(input.name, 200, 'Nombre');
  if (!name) throw new ValidationError('El nombre es requerido');
  const code = optionalText(input.code, 50, 'Código');
  const dni = optionalText(input.dni, 8, 'DNI');
  if (dni && !/^\d{8}$/.test(dni)) throw new ValidationError('El DNI debe tener 8 dígitos');
  let tickets = [];
  const hasStart = input.ticketStart != null && input.ticketStart !== '';
  const hasEnd = input.ticketEnd != null && input.ticketEnd !== '';
  if (hasStart !== hasEnd) throw new ValidationError('Indica el inicio y el fin del rango');
  if (hasStart) {
    const start = ticketNumber(input.ticketStart);
    const end = ticketNumber(input.ticketEnd);
    if (end < start || end - start + 1 > MAX_TICKETS_PER_STUDENT) throw new ValidationError(`Rango inválido: máximo ${MAX_TICKETS_PER_STUDENT} tickets`);
    tickets = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  return { name, code, dni, tickets };
}

export function importRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`El archivo debe contener entre 1 y ${MAX_IMPORT_ROWS} estudiantes`);
  const seen = new Set();
  return rows.map((row, index) => {
    try {
      const student = studentInput({ name: row.nombre, code: row.codigo, dni: row.dni, ticketStart: row.ticket_inicio, ticketEnd: row.ticket_fin });
      if (row.tickets && student.tickets.length) throw new ValidationError('Usa un rango o una lista de tickets, no ambos');
      if (row.tickets) {
        student.tickets = row.tickets.split(/[;,]/).map(ticketNumber);
        if (student.tickets.length > MAX_TICKETS_PER_STUDENT) throw new ValidationError('Demasiados tickets por estudiante');
      }
      for (const number of student.tickets) {
        if (seen.has(number)) throw new ValidationError(`Ticket ${number} repetido en el archivo`);
        seen.add(number);
      }
      if (seen.size > MAX_IMPORT_TICKETS) throw new ValidationError(`Máximo ${MAX_IMPORT_TICKETS} tickets por archivo`);
      return student;
    } catch (error) { throw new ValidationError(`Fila ${index + 2}: ${error.message}`); }
  });
}

export function pickupInput(body) {
  if (!body || typeof body.isPickedUp !== 'boolean') throw new ValidationError('Estado de entrega inválido');
  if (!Array.isArray(body.ticketIds) || !body.ticketIds.length || body.ticketIds.length > MAX_TICKETS_PER_STUDENT) throw new ValidationError('Selecciona entre 1 y 2000 tickets');
  const ticketIds = body.ticketIds.map(validateUuid);
  if (new Set(ticketIds).size !== ticketIds.length) throw new ValidationError('Hay tickets repetidos');
  const method = body.paymentMethod === 'en_momento' ? 'en_momento_efectivo' : body.paymentMethod;
  if (body.isPickedUp && !PAYMENT_METHODS.includes(method)) throw new ValidationError('Método de pago inválido');
  const expectedMovementId = body.isPickedUp ? null : validateUuid(body.expectedMovementId);
  return { ticketIds, isPickedUp: body.isPickedUp, paymentMethod: body.isPickedUp ? method : null, expectedMovementId };
}
