/**
 * Debounce function - delays execution until after wait ms have elapsed
 * since the last call.
 */
export function debounce(fn, wait = 300) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Format a date string to locale-friendly format
 */
export function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calculate percentage
 */
export function percentage(part, total) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Parse CSV text into an array of objects
 */
export function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));

  return lines.slice(1).map((line) => {
    // Handle commas inside quotes
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

/**
 * Generate a range of ticket numbers
 */
export function generateTicketRange(start, end) {
  const tickets = [];
  for (let i = start; i <= end; i++) {
    tickets.push(i);
  }
  return tickets;
}

/**
 * Classnames helper - joins truthy class names
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Format ticket number with leading zeros (4 digits)
 * e.g., 1 → "0001", 240 → "0240"
 */
export function formatTicketNumber(num) {
  return String(num).padStart(4, '0');
}
