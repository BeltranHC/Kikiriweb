import { parseCSV } from './csv.mjs';
import { ValidationError, validateUuid, ticketNumber, MAX_TICKETS_PER_STUDENT } from './validation.mjs';

export const SEMESTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const PROMOTION_SEMESTER = 11;
export const RECIPIENT_TYPES = { student: 'Estudiante', external: 'Externo', teacher: 'Docente' };
export function recipientType(value = 'student') { if (typeof value !== 'string' || !Object.hasOwn(RECIPIENT_TYPES, value)) throw new ValidationError('Tipo de participante inv\u00e1lido'); return value; }
export const recipientLabel = person => (person.recipient_type || 'student') === 'student' ? semesterLabel(person.semester) : RECIPIENT_TYPES[person.recipient_type];
export const MAX_FACULTY_ROWS = 1000;
export function semesterNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === 'PROMOCION') return PROMOTION_SEMESTER;
  const number = typeof value === 'string' ? (SEMESTERS.indexOf(value.trim().toUpperCase()) + 1 || Number(value.trim())) : value;
  if (!Number.isInteger(number) || number < 1 || number > PROMOTION_SEMESTER) throw new ValidationError('Selecciona un semestre del I al X o Promoción');
  return number;
}
export const semesterLabel = value => value == null ? 'Sin semestre' : value === PROMOTION_SEMESTER ? 'Promoción' : `${SEMESTERS[value - 1]} semestre`;
function text(value, max, label, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label} inválido`);
  const clean = value.trim().replace(/\s+/g, ' ');
  if ((!clean && required) || clean.length > max) throw new ValidationError(`${label}: ${required ? 'requerido, ' : ''}máximo ${max} caracteres`);
  return clean || null;
}
export function facultyStudentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Datos de estudiante inválidos');
  const type = recipientType(input.recipientType);
  const code = text(input.code, 50, 'Código', type === 'student')?.toUpperCase() || null;
  if (code && !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) throw new ValidationError('El código solo admite letras, números, punto, guion y guion bajo');
  return { name: text(input.name, 200, 'Nombre', true), code, semester: type === 'student' ? semesterNumber(input.semester) : null, recipientType: type, school: text(input.school, 120, 'Escuela') };
}
export function facultyEditInput(input) {
  const student = facultyStudentInput(input);
  const id = validateUuid(input.id);
  if (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
    throw new ValidationError('Actualiza el padrón antes de editar este estudiante');
  }
  return { ...student, id, expectedUpdatedAt: input.expectedUpdatedAt };
}
export function parseFacultyCSV(input) {
  let rows;
  try { rows = parseCSV(input); } catch (error) { throw new ValidationError(error.message); }
  if (!rows.length || rows.length > MAX_FACULTY_ROWS) throw new ValidationError(`El padrón debe contener entre 1 y ${MAX_FACULTY_ROWS} estudiantes`);
  const codes = new Set();
  const students = rows.map((row, index) => {
    try {
      if (!('codigo' in row) || !('nombre' in row) || !('semestre' in row)) throw new ValidationError('Faltan las columnas Código, Nombres y Semestre');
      const student = facultyStudentInput({ name: row.apellidos ? `${row.apellidos} ${row.nombre}` : row.nombre, code: row.codigo, semester: row.semestre, school: row.escuela_profesional || row.escuela });
      if (codes.has(student.code)) throw new ValidationError(`Código ${student.code} repetido en el archivo`);
      codes.add(student.code);
      return student;
    } catch (error) { throw new ValidationError(`Fila ${index + 2}: ${error.message}`); }
  });
  return students.sort((a, b) => (a.semester ?? 12) - (b.semester ?? 12) || a.name.localeCompare(b.name, 'es') || a.code.localeCompare(b.code));
}
export function decodeFacultyCSV(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252', { fatal: true }).decode(buffer); }
}
export function parseTicketNumbers(input) {
  if (typeof input !== 'string' || input.length > 24000) throw new ValidationError('Lista de tickets inválida');
  if (!input.trim()) return [];
  const numbers = [];
  const seen = new Set();
  for (const token of input.trim().split(/[\s,;]+/)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    const start = ticketNumber(range ? range[1] : token);
    const end = range ? ticketNumber(range[2]) : start;
    if (end < start || end - start + 1 + numbers.length > MAX_TICKETS_PER_STUDENT) throw new ValidationError(`Indica un rango ascendente y hasta ${MAX_TICKETS_PER_STUDENT} tickets`);
    for (let number = start; number <= end; number++) {
      if (seen.has(number)) throw new ValidationError(`El ticket ${number} está repetido`);
      seen.add(number); numbers.push(number);
    }
  }
  return numbers.sort((a, b) => a - b);
}
export function allocationInput(input) {
  if (!input || !Array.isArray(input.ticketNumbers) || input.ticketNumbers.length < 1 || input.ticketNumbers.length > MAX_TICKETS_PER_STUDENT) throw new ValidationError('Selecciona entre 1 y 2000 tickets');
  const numbers = input.ticketNumbers.map(ticketNumber);
  if (new Set(numbers).size !== numbers.length) throw new ValidationError('Hay tickets repetidos');
  return { studentId: validateUuid(input.studentId), ticketNumbers: numbers.sort((a, b) => a - b), paymentMethod: facultyPaymentMethod(input.paymentMethod) };
}

export function ticketEditInput(input) {
  if (!input || typeof input !== 'object' || !['update','transfer','release'].includes(input.action)) throw new ValidationError('Corrección de ticket inválida');
  if (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new ValidationError('Actualiza los tickets antes de modificarlos');
  return { ticketId: validateUuid(input.ticketId), studentId: validateUuid(input.studentId), action: input.action,
    ticketNumber: input.action === 'update' ? ticketNumber(input.ticketNumber) : null,
    destinationId: input.action === 'transfer' ? validateUuid(input.destinationId) : null, expectedUpdatedAt: input.expectedUpdatedAt };
}

export const FACULTY_PAYMENT_LABELS = { cash: 'Efectivo', yape: 'Yape' };
export function facultyPaymentMethod(value, allowPending = true) {
  if (allowPending && (value == null || value === 'pending')) return null;
  if (typeof value !== 'string' || !Object.hasOwn(FACULTY_PAYMENT_LABELS, value)) throw new ValidationError('Selecciona efectivo o Yape');
  return value;
}
export function ticketIdentityInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new ValidationError('Actualiza el ticket antes de continuar');
  return { ticketId: validateUuid(input.ticketId), studentId: validateUuid(input.studentId), expectedUpdatedAt: input.expectedUpdatedAt };
}
export function facultyPaymentInput(input) {
  const ticket = ticketIdentityInput(input);
  if (!['pay','void'].includes(input.action)) throw new ValidationError('Operacion de pago invalida');
  return { ...ticket, action: input.action, method: input.action === 'pay' ? facultyPaymentMethod(input.method, false) : null };
}
export function facultyDeleteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new ValidationError('Actualiza el participante antes de eliminar');
  if (!Array.isArray(input.expectedTickets) || input.expectedTickets.length > 10000) throw new ValidationError('Actualiza las asignaciones antes de eliminar');
  const seen = new Set();
  const expectedTickets = input.expectedTickets.map(ticket => {
    if (!ticket || typeof ticket.updated_at !== 'string' || ticket.updated_at.length > 50 || !Number.isFinite(Date.parse(ticket.updated_at))) throw new ValidationError('Version de ticket invalida');
    const id = validateUuid(ticket.id); if (seen.has(id.toLowerCase())) throw new ValidationError('Tickets repetidos'); seen.add(id.toLowerCase());
    return { id, updated_at: ticket.updated_at };
  });
  return { id: validateUuid(input.id), expectedUpdatedAt: input.expectedUpdatedAt, expectedTickets };
}
