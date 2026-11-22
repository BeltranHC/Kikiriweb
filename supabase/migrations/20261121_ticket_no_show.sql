-- "No recogio": marca tickets asignados que la persona nunca recogio, para no cobrarlos.
-- Requiere las migraciones de Entregas, Prepagado y Estadisticas. No modifica filas existentes.
-- El ticket conserva su asignacion; deja de contar como deuda en Deudores y Estadisticas.
BEGIN;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS no_show_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS no_show_by_email text;

-- Si luego se entrega o se cobra el ticket, deja de estar marcado como "No recogio".
CREATE OR REPLACE FUNCTION public.clear_ticket_no_show() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.no_show_at IS NOT NULL AND (NEW.is_picked_up OR NEW.is_paid OR NEW.deleted_at IS NOT NULL OR NEW.student_id IS DISTINCT FROM OLD.student_id) THEN
    NEW.no_show_at:=NULL; NEW.no_show_by_email:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER clear_ticket_no_show BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.clear_ticket_no_show();

-- Marca o desmarca "No recogio". Al marcar, anula la entrega (queda registrada como anulacion en el historial).
-- Un Prepagado debe anularse antes con set_faculty_ticket_payment; un pago real impide marcarlo.
CREATE OR REPLACE FUNCTION public.set_ticket_no_show(p_ticket_id uuid,p_student_id uuid,p_expected_updated_at timestamptz,p_no_show boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_id IS NULL OR p_student_id IS NULL OR p_expected_updated_at IS NULL OR p_no_show IS NULL THEN RAISE EXCEPTION 'Solicitud invalida' USING ERRCODE='22023'; END IF;
  PERFORM id FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.deleted_at IS NOT NULL OR v_ticket.is_available THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_ticket.student_id IS DISTINCT FROM p_student_id OR v_ticket.assignment_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Otro usuario modifico este ticket. Actualiza la lista.' USING ERRCODE='P0001';
  END IF;
  IF p_no_show THEN
    IF v_ticket.no_show_at IS NOT NULL THEN RAISE EXCEPTION 'El ticket % ya figura como No recogio.',v_ticket.ticket_number USING ERRCODE='P0001'; END IF;
    IF v_ticket.is_paid THEN RAISE EXCEPTION 'El ticket % tiene un pago registrado; anulalo antes de marcar No recogio.',v_ticket.ticket_number USING ERRCODE='P0001'; END IF;
    IF v_ticket.is_picked_up THEN
      INSERT INTO public.ticket_movements(kind,actor_id,actor_email,ticket_ids,ticket_snapshots)
        VALUES('undo',auth.uid(),auth.jwt()->>'email',ARRAY[p_ticket_id],public.snapshot_delivery_tickets(ARRAY[p_ticket_id]));
    END IF;
    UPDATE public.tickets SET is_picked_up=false,picked_up_at=NULL,picked_up_by=NULL,movement_id=NULL,no_show_at=clock_timestamp(),no_show_by_email=auth.jwt()->>'email'
      WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  ELSE
    IF v_ticket.no_show_at IS NULL THEN RAISE EXCEPTION 'El ticket % no figura como No recogio.',v_ticket.ticket_number USING ERRCODE='P0001'; END IF;
    UPDATE public.tickets SET no_show_at=NULL,no_show_by_email=NULL WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  END IF;
  RETURN jsonb_build_object('ticket',to_jsonb(v_ticket),'action',CASE WHEN p_no_show THEN 'no_show' ELSE 'restore' END);
END $$;
REVOKE ALL ON FUNCTION public.set_ticket_no_show(uuid,uuid,timestamptz,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_ticket_no_show(uuid,uuid,timestamptz,boolean) TO authenticated;

-- Estadisticas y Deudores leen el nuevo estado.
CREATE OR REPLACE FUNCTION public.ticket_analytics_source() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  -- Una sola sentencia garantiza una misma instantanea para todas las tablas.
  SELECT jsonb_build_object(
    'students',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code,'semester',s.semester,'recipient_type',s.recipient_type,'deleted_at',s.deleted_at)) FROM public.students s),'[]'::jsonb),
    'tickets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'ticket_number',t.ticket_number,'student_id',t.student_id,'is_extra',t.is_extra,'is_available',t.is_available,'deleted_at',t.deleted_at,'is_picked_up',t.is_picked_up,'is_paid',t.is_paid,'payment_method',t.payment_method,'paid_amount',t.paid_amount,'unit_price',t.unit_price,'no_show_at',t.no_show_at,'no_show_by_email',t.no_show_by_email)) FROM public.tickets t),'[]'::jsonb),
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
SELECT 'Opcion No recogio habilitada. No se modificaron participantes, tickets, pagos ni historial.' AS resultado;
NOTIFY pgrst,'reload schema';
COMMIT;
