-- Deudores: cobro y "No recogio" en una sola transaccion (todo o nada).
-- Antes, la pantalla anulaba el Prepagado y cobraba con llamadas separadas por ticket: un corte de
-- conexion a la mitad dejaba unos tickets cobrados y otros sin pago. Requiere 20261121_ticket_no_show.sql.
-- Solo crea dos funciones. No modifica filas existentes y puede ejecutarse mas de una vez.
BEGIN;

-- Valida la seleccion del modal, bloquea ficha y tickets en el orden habitual y comprueba versiones.
-- Devuelve los tickets bloqueados ordenados por numero.
CREATE OR REPLACE FUNCTION public.lock_pending_selection(p_student_id uuid,p_tickets jsonb) RETURNS SETOF public.tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_tickets IS NULL OR jsonb_typeof(p_tickets)<>'array' OR jsonb_array_length(p_tickets) NOT BETWEEN 1 AND 2000 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_tickets) e WHERE jsonb_typeof(e)<>'object'
      OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'updated_at') IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'Seleccion de tickets invalida' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) WHERE id IS NULL OR updated_at IS NULL OR NOT isfinite(updated_at))
    OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz))<>jsonb_array_length(p_tickets) THEN
    RAISE EXCEPTION 'Tickets repetidos o versiones invalidas' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  PERFORM t.id FROM public.tickets t JOIN jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) ON e.id=t.id ORDER BY t.id FOR UPDATE OF t;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>jsonb_array_length(p_tickets) THEN RAISE EXCEPTION 'No se encontraron todos los tickets' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.tickets t JOIN jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) ON e.id=t.id
    WHERE t.student_id IS DISTINCT FROM p_student_id OR t.deleted_at IS NOT NULL OR t.is_available OR t.assignment_updated_at IS DISTINCT FROM e.updated_at) THEN
    RAISE EXCEPTION 'Los tickets cambiaron desde que abriste la ventana; puede que el cambio ya se haya guardado. Actualiza la lista para comprobarlo.' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY SELECT t.* FROM public.tickets t WHERE t.id IN(SELECT id FROM jsonb_to_recordset(p_tickets) e(id uuid)) ORDER BY t.ticket_number;
END $$;

-- Cobra en efectivo o Yape todos los tickets elegidos. Los entregados como Prepagado se anulan (reverso de S/ 0)
-- y se cobran en la misma transaccion. Si un ticket no se puede cobrar o el total no coincide, no se guarda nada.
CREATE OR REPLACE FUNCTION public.pay_pending_tickets(p_student_id uuid,p_tickets jsonb,p_method text,p_expected_total numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;v_version timestamptz;v_total numeric(14,2):=0;v_result jsonb;v_results jsonb:='[]'::jsonb;v_voided integer:=0;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_method IS NULL OR p_method NOT IN('cash','yape') OR p_expected_total IS NULL OR p_expected_total<0 OR p_expected_total::text IN('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Datos del cobro invalidos' USING ERRCODE='22023';
  END IF;
  FOR v_ticket IN SELECT * FROM public.lock_pending_selection(p_student_id,p_tickets) LOOP
    IF v_ticket.no_show_at IS NOT NULL THEN RAISE EXCEPTION 'El ticket #% figura como No recogio. Deshaz esa marca antes de cobrarlo. No se cobro ningun ticket.',v_ticket.ticket_number USING ERRCODE='P0001'; END IF;
    IF v_ticket.is_paid AND split_part(coalesce(v_ticket.payment_method,''),'|',1)<>'prepaid' THEN
      RAISE EXCEPTION 'El ticket #% ya tiene un pago registrado. No se cobro ningun ticket.',v_ticket.ticket_number USING ERRCODE='P0001';
    END IF;
    IF v_ticket.unit_price IS NULL OR v_ticket.unit_price<=0 OR v_ticket.unit_price::text IN('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'El precio del ticket #% requiere revision. No se cobro ningun ticket.',v_ticket.ticket_number USING ERRCODE='P0001';
    END IF;
    v_total:=v_total+v_ticket.unit_price;
  END LOOP;
  IF v_total IS DISTINCT FROM p_expected_total::numeric(14,2) THEN
    RAISE EXCEPTION 'El total cambio: ahora es S/ %. Revisa los tickets y confirma de nuevo. No se cobro ningun ticket.',v_total USING ERRCODE='P0001';
  END IF;
  FOR v_ticket IN SELECT t.* FROM public.tickets t WHERE t.id IN(SELECT id FROM jsonb_to_recordset(p_tickets) e(id uuid)) ORDER BY t.ticket_number LOOP
    v_version:=v_ticket.assignment_updated_at;
    IF v_ticket.is_paid THEN
      v_result:=public.set_faculty_ticket_payment(v_ticket.id,p_student_id,'void',NULL,v_version);
      v_version:=(v_result->'ticket'->>'assignment_updated_at')::timestamptz;v_voided:=v_voided+1;
    END IF;
    v_result:=public.set_faculty_ticket_payment(v_ticket.id,p_student_id,'pay',p_method,v_version);
    v_results:=v_results||jsonb_build_array(v_result->'ticket');
  END LOOP;
  RETURN jsonb_build_object('studentId',p_student_id,'changed',jsonb_array_length(v_results),'prepaidVoided',v_voided,'total',v_total,'method',p_method,'tickets',v_results);
END $$;

-- Marca (true) o desmarca (false) "No recogio" para todos los tickets elegidos. Al marcar, un Prepagado se anula
-- en la misma transaccion; un pago real lo impide y entonces no se marca ningun ticket.
CREATE OR REPLACE FUNCTION public.set_pending_no_show(p_student_id uuid,p_tickets jsonb,p_no_show boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;v_version timestamptz;v_result jsonb;v_changed integer:=0;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_no_show IS NULL THEN RAISE EXCEPTION 'Indica si el participante recogio o no' USING ERRCODE='22023'; END IF;
  FOR v_ticket IN SELECT * FROM public.lock_pending_selection(p_student_id,p_tickets) LOOP
    IF p_no_show AND v_ticket.no_show_at IS NULL AND v_ticket.is_paid AND split_part(coalesce(v_ticket.payment_method,''),'|',1)<>'prepaid' THEN
      RAISE EXCEPTION 'El ticket #% tiene un pago registrado; no se puede marcar como No recogio. No se marco ningun ticket.',v_ticket.ticket_number USING ERRCODE='P0001';
    END IF;
  END LOOP;
  FOR v_ticket IN SELECT t.* FROM public.tickets t WHERE t.id IN(SELECT id FROM jsonb_to_recordset(p_tickets) e(id uuid)) ORDER BY t.ticket_number LOOP
    IF p_no_show=(v_ticket.no_show_at IS NOT NULL) THEN CONTINUE; END IF;
    v_version:=v_ticket.assignment_updated_at;
    IF p_no_show AND v_ticket.is_paid THEN
      v_result:=public.set_faculty_ticket_payment(v_ticket.id,p_student_id,'void',NULL,v_version);
      v_version:=(v_result->'ticket'->>'assignment_updated_at')::timestamptz;
    END IF;
    PERFORM public.set_ticket_no_show(v_ticket.id,p_student_id,v_version,p_no_show);
    v_changed:=v_changed+1;
  END LOOP;
  RETURN jsonb_build_object('studentId',p_student_id,'changed',v_changed,'noShow',p_no_show);
END $$;

REVOKE ALL ON FUNCTION public.lock_pending_selection(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pay_pending_tickets(uuid,jsonb,text,numeric),public.set_pending_no_show(uuid,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_pending_tickets(uuid,jsonb,text,numeric),public.set_pending_no_show(uuid,jsonb,boolean) TO authenticated;
SELECT 'Cobro y No recogio de Deudores ahora son todo o nada. No se modificaron tickets, pagos ni historial.' AS resultado;
NOTIFY pgrst,'reload schema';
COMMIT;
