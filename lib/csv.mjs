export const MAX_CSV_BYTES = 2 * 1024 * 1024;

function headerName(value) {
  const key = value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  return ({ nombres: 'nombre', name: 'nombre', code: 'codigo', inicio: 'ticket_inicio', fin: 'ticket_fin', ticket_start: 'ticket_inicio', ticket_end: 'ticket_fin' })[key] || key;
}

export function parseCSV(input) {
  const text = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const header = text.split('\n')[0];
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === ',') commas++;
    if (!quoted && char === ';') semicolons++;
  }
  const delimiter = semicolons > commas ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let afterQuote = false;
  quoted = false;
  const finishField = () => { row.push(field.trim()); field = ''; afterQuote = false; };
  const finishRow = () => { finishField(); if (row.some(value => value !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === delimiter) finishField();
    else if (char === '\n') finishRow();
    else if (char === '"' && !field.trim() && !afterQuote) { quoted = true; field = ''; }
    else if (char === '"' || (afterQuote && char.trim())) throw new Error('CSV inválido: comillas mal cerradas');
    else field += char;
  }
  if (quoted) throw new Error('CSV inválido: falta cerrar comillas');
  finishRow();
  if (!rows.length) return [];
  const headers = rows.shift().map(headerName);
  if (headers.some(key => !key) || new Set(headers).size !== headers.length) throw new Error('El CSV contiene encabezados vacíos o repetidos');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Fila ${index + 2}: cantidad de columnas incorrecta`);
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function stringifyCSV(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
