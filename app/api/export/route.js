import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();

  try {
    // We fetch all picked up tickets with their student information
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select(`
        ticket_number,
        is_paid,
        payment_method,
        picked_up_at,
        picked_up_by,
        is_extra,
        student_id,
        students (
          name,
          code,
          dni
        )
      `)
      .eq('is_picked_up', true)
      .order('picked_up_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Prepare CSV Content
    let csvContent = 'Nro_Ticket,Estudiante,Codigo,Metodo_Pago,Fecha_Hora,Entregado_A\n';
    
    let totalCash = 0;
    
    if (tickets && tickets.length > 0) {
      tickets.forEach(ticket => {
        const studentName = ticket.students?.name || 'Desconocido';
        const code = ticket.students?.code || '';
        
        const [method, email] = (ticket.payment_method || '').split('|');
        const paymentMethod = method === 'en_momento' ? 'Pagado en Caja (S/15)' : 'Pagado Previamente';
        const cashierEmail = email || 'Desconocido';

        if (method === 'en_momento') {
          totalCash += 15;
        }

        // Format Date
        const dateObj = new Date(ticket.picked_up_at);
        const formattedDate = dateObj.toLocaleString('es-PE', { timeZone: 'America/Lima' });

        csvContent += `"${ticket.ticket_number}","${studentName}","${code}","${paymentMethod}","${formattedDate}","${cashierEmail}"\n`;
      });
    }

    // Add a summary row at the bottom
    csvContent += `\nRESUMEN DE CAJA\n`;
    csvContent += `Total Tickets Entregados,${tickets?.length || 0}\n`;
    csvContent += `Efectivo Recaudado (S/),${totalCash}\n`;

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cierre_caja_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
