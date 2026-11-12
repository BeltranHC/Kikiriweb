-- Dashboard de Estadisticas: agrega una sola funcion de lectura.
-- Requiere las migraciones de Entregas y Prepagado. No modifica ninguna fila.
BEGIN;
CREATE OR REPLACE FUNCTION public.ticket_analytics_source() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  -- Una sola sentencia garantiza una misma instantanea para todas las tablas.
  SELECT jsonb_build_object(
    'students',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code,'semester',s.semester,'recipient_type',s.recipient_type,'deleted_at',s.deleted_at)) FROM public.students s),'[]'::jsonb),
    'tickets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'ticket_number',t.ticket_number,'student_id',t.student_id,'is_extra',t.is_extra,'is_available',t.is_available,'deleted_at',t.deleted_at,'is_picked_up',t.is_picked_up,'is_paid',t.is_paid,'payment_method',t.payment_method,'paid_amount',t.paid_amount,'unit_price',t.unit_price)) FROM public.tickets t),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'student_id',a.student_id,'created_at',a.created_at,'actor_email',a.actor_email,'count',cardinality(a.ticket_numbers))) FROM public.ticket_assignments a),'[]'::jsonb),
    'movements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'created_at',m.created_at,'actor_email',m.actor_email,'items',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',ids.id,'student_id',coalesce(snap.value->>'student_id',t.student_id::text),'is_extra',t.is_extra)),'[]'::jsonb)
       FROM unnest(m.ticket_ids) ids(id) LEFT JOIN public.tickets t ON t.id=ids.id
       LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(m.ticket_snapshots) WHERE value->>'id'=ids.id::text LIMIT 1) snap ON true))) FROM public.ticket_movements m),'[]'::jsonb),
    'cash',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.event_id,'ticket_id',e.ticket_id,'student_id',coalesce(e.snapshot->>'student_id',t.student_id::text),'is_extra',t.is_extra,'kind',e.kind,'amount',e.amount,'method',e.method,'created_at',e.created_at,'actor_email',e.actor_email,'source',e.source)) FROM public.ticket_cash_events() e LEFT JOIN public.tickets t ON t.id=e.ticket_id),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.ticket_analytics_source() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ticket_analytics_source() TO authenticated;
SELECT 'Dashboard de Estadisticas habilitado. No se modificaron participantes, tickets, pagos ni historial.' AS resultado;
NOTIFY pgrst,'reload schema';
COMMIT;
