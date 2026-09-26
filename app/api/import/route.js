import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// POST: Import students and tickets from CSV
export async function POST(request) {
  const supabase = createClient();

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.trim().split('\n');

    if (lines.length < 2) {
      return NextResponse.json({ error: 'El archivo está vacío o no tiene datos' }, { status: 400 });
    }

    // Detect delimiter
    const delimiter = lines[0].includes(';') ? ';' : ',';

    // Parse headers
    const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));

    let studentsCreated = 0;
    let ticketsCreated = 0;
    const errors = [];

    // Process each row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse values (handle quoted fields)
      const values = [];
      let current = '';
      let inQuotes = false;

      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      // Build row object
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });

      const name = row.nombre || row.name || '';
      const code = row.codigo || row.code || '';
      const dni = row.dni || '';

      if (!name) {
        errors.push(`Fila ${i + 1}: nombre vacío`);
        continue;
      }

      // Create student
      const { data: student, error: studentError } = await supabase
        .from('students')
        .insert({
          name,
          code: code || null,
          dni: dni || null,
        })
        .select()
        .single();

      if (studentError) {
        errors.push(`Fila ${i + 1}: ${studentError.message}`);
        continue;
      }

      studentsCreated++;

      // Create tickets
      let ticketNumbers = [];

      // Option 1: ticket_inicio and ticket_fin (range)
      const ticketStart = parseInt(row.ticket_inicio || row.ticket_start || '');
      const ticketEnd = parseInt(row.ticket_fin || row.ticket_end || '');

      if (!isNaN(ticketStart) && !isNaN(ticketEnd) && ticketStart <= ticketEnd) {
        for (let t = ticketStart; t <= ticketEnd; t++) {
          ticketNumbers.push(t);
        }
      }

      // Option 2: tickets column (semicolon or comma separated)
      if (ticketNumbers.length === 0 && row.tickets) {
        const separator = row.tickets.includes(';') ? ';' : ',';
        ticketNumbers = row.tickets
          .split(separator)
          .map((n) => parseInt(n.trim()))
          .filter((n) => !isNaN(n));
      }

      if (ticketNumbers.length > 0) {
        const tickets = ticketNumbers.map((num) => ({
          ticket_number: num,
          student_id: student.id,
          is_picked_up: false,
          is_extra: false,
        }));

        const { error: ticketError } = await supabase
          .from('tickets')
          .insert(tickets);

        if (ticketError) {
          errors.push(`Fila ${i + 1}: Error en tickets - ${ticketError.message}`);
        } else {
          ticketsCreated += tickets.length;
        }
      }
    }

    return NextResponse.json({
      studentsCreated,
      ticketsCreated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Import error:', err);
    return NextResponse.json({ error: 'Error al procesar el archivo' }, { status: 500 });
  }
}
