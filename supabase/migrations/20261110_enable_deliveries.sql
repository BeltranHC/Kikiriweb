-- Habilitar Entregas sin reiniciar asignaciones, pagos ni caja.
-- Requiere las migraciones anteriores, incluida 20261106_batch_ticket_payments.sql.
-- Agrega una base inmutable de pagos antiguos; no cobra ni entrega tickets al instalar.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- La instalacion no llama a las funciones de eliminar, pagar, anular ni reasignar.
-- Guardar cada fila original y verificarla antes de confirmar. Las copias son temporales.
CREATE TEMP TABLE pg_temp.kikiri_delivery_install_before (
  entity text NOT NULL, id uuid NOT NULL, original jsonb NOT NULL, PRIMARY KEY(entity,id)
) ON COMMIT DROP;
ALTER TABLE pg_temp.kikiri_delivery_install_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_delivery_install_before FROM PUBLIC,anon,authenticated,service_role;
DO $capture_existing_data$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments'] LOOP
    IF to_regclass(format('public.%I',v_table)) IS NULL THEN
      IF v_table='faculty_payments' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Falta la tabla %. Ejecuta primero las migraciones anteriores.',v_table;
    END IF;
    -- Bloqueo acotado por lock_timeout. Las consultas y escrituras pueden esperar durante la migracion.
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_table);
    EXECUTE format('INSERT INTO pg_temp.kikiri_delivery_install_before(entity,id,original) SELECT $1,t.id,to_jsonb(t) FROM public.%I t',v_table) USING v_table;
  END LOOP;
END $capture_existing_data$;


CREATE TABLE IF NOT EXISTS public.legacy_ticket_payments (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id), amount numeric(10,2) NOT NULL CHECK(amount>0),
  method text NOT NULL CHECK(method IN('cash','yape','legacy')), paid_at timestamptz,
  actor_email text, snapshot jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.legacy_ticket_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_ticket_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legacy_ticket_payments TO authenticated;
GRANT ALL ON public.legacy_ticket_payments TO service_role;
DO $policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.legacy_ticket_payments'::regclass AND polname='authenticated_read_legacy_payments') THEN
  CREATE POLICY authenticated_read_legacy_payments ON public.legacy_ticket_payments FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'is_anonymous','false')<>'true');
 END IF;
END $policy$;
-- Una fecha desconocida se mantiene desconocida: cuenta en acumulado, no se inventa un cobro de hoy.
WITH candidates AS (
 SELECT t.id ticket_id,coalesce(t.paid_amount,t.unit_price) amount,
  CASE split_part(t.payment_method,'|',1) WHEN 'en_momento' THEN 'cash' WHEN 'en_momento_efectivo' THEN 'cash' WHEN 'en_momento_yape' THEN 'yape' ELSE 'legacy' END method,
  coalesce(t.paid_at,t.picked_up_at) paid_at,nullif(split_part(t.payment_method,'|',2),'') actor_email,
  to_jsonb(t)||jsonb_build_object('student_name',s.name,'student_code',s.code) snapshot,1 priority,t.created_at source_time
 FROM public.tickets t LEFT JOIN public.students s ON s.id=t.student_id WHERE t.is_paid AND t.payment_id IS NULL
 UNION ALL
 SELECT p.ticket_id,p.amount,p.method,coalesce(nullif(p.ticket_snapshot->>'paid_at','')::timestamptz,nullif(p.ticket_snapshot->>'picked_up_at','')::timestamptz),
  nullif(split_part(p.ticket_snapshot->>'payment_method','|',2),''),p.ticket_snapshot,0,p.created_at
 FROM public.faculty_payments p WHERE p.kind='void' AND p.is_legacy
)
INSERT INTO public.legacy_ticket_payments(ticket_id,amount,method,paid_at,actor_email,snapshot)
 SELECT DISTINCT ON(ticket_id) ticket_id,amount,method,paid_at,actor_email,snapshot FROM candidates ORDER BY ticket_id,priority,source_time
 ON CONFLICT(ticket_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.set_faculty_ticket_payment(
  p_ticket_id uuid,p_student_id uuid,p_action text,p_method text DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;v_prior public.faculty_payments;v_id uuid:=gen_random_uuid();v_amount numeric(10,2);v_method text;v_snapshot jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_id IS NULL OR p_student_id IS NULL OR p_action IS NULL OR p_action NOT IN('pay','void') OR p_expected_updated_at IS NULL
    OR (p_action='pay' AND (p_method IS NULL OR p_method NOT IN('cash','yape'))) THEN
    RAISE EXCEPTION 'Datos de pago invalidos' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.deleted_at IS NOT NULL OR v_ticket.is_available THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_ticket.student_id IS DISTINCT FROM p_student_id OR v_ticket.assignment_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Otro usuario modifico este ticket. Actualiza el padron antes de continuar.' USING ERRCODE='P0001';
  END IF;
  IF (p_action='pay' AND v_ticket.is_paid) OR (p_action='void' AND NOT v_ticket.is_paid) THEN
    RAISE EXCEPTION 'El estado del pago cambio. Actualiza el padron.' USING ERRCODE='P0001';
  END IF;
  SELECT to_jsonb(v_ticket)||jsonb_build_object('student_name',s.name,'student_code',s.code) INTO v_snapshot FROM public.students s WHERE s.id=p_student_id;
  v_amount:=v_ticket.unit_price;v_method:=p_method;
  IF p_action='void' THEN
    IF v_ticket.payment_id IS NOT NULL THEN
      SELECT * INTO v_prior FROM public.faculty_payments WHERE id=v_ticket.payment_id AND ticket_id=p_ticket_id AND kind='payment';
      IF NOT FOUND THEN RAISE EXCEPTION 'El pago registrado requiere revision' USING ERRCODE='P0001'; END IF;
      v_amount:=v_prior.amount;v_method:=v_prior.method;
    ELSE
      SELECT amount,method INTO v_amount,v_method FROM public.legacy_ticket_payments WHERE ticket_id=v_ticket.id;
      IF NOT FOUND THEN
        v_amount:=v_ticket.unit_price;
      v_method:=CASE split_part(v_ticket.payment_method,'|',1) WHEN 'en_momento' THEN 'cash' WHEN 'en_momento_efectivo' THEN 'cash' WHEN 'en_momento_yape' THEN 'yape' ELSE 'legacy' END;
      END IF;
    END IF;
  END IF;
  IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'El precio del ticket requiere revision' USING ERRCODE='22023'; END IF;
  INSERT INTO public.faculty_payments(id,ticket_id,kind,amount,method,actor_id,actor_email,reverses_id,is_legacy,ticket_snapshot)
    VALUES(v_id,p_ticket_id,CASE WHEN p_action='pay' THEN 'payment' ELSE 'void' END,v_amount,v_method,auth.uid(),auth.jwt()->>'email',
      CASE WHEN p_action='void' THEN v_ticket.payment_id ELSE NULL END,p_action='void' AND v_ticket.payment_id IS NULL,v_snapshot);
  UPDATE public.tickets SET is_paid=p_action='pay',
    payment_method=CASE WHEN p_action='pay' THEN (CASE p_method WHEN 'cash' THEN 'en_momento_efectivo' ELSE 'en_momento_yape' END)||'|'||coalesce(auth.jwt()->>'email','') ELSE NULL END,
    paid_at=CASE WHEN p_action='pay' THEN clock_timestamp() ELSE NULL END,paid_amount=CASE WHEN p_action='pay' THEN v_amount ELSE NULL END,
    paid_by=CASE WHEN p_action='pay' THEN auth.uid() ELSE NULL END,paid_by_email=CASE WHEN p_action='pay' THEN auth.jwt()->>'email' ELSE NULL END,
    payment_id=CASE WHEN p_action='pay' THEN v_id ELSE NULL END
    WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('ticket',to_jsonb(v_ticket)||jsonb_build_object('can_manage',true,'can_edit',NOT(v_ticket.is_paid OR v_ticket.is_extra OR v_ticket.is_picked_up OR v_ticket.movement_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.ticket_movements WHERE ticket_ids @> ARRAY[v_ticket.id]))),
    'action',p_action,'previousStudentId',p_student_id,'paymentEventId',v_id,'amount',v_amount);
END $$;

CREATE OR REPLACE FUNCTION public.set_faculty_ticket_payments(
  p_student_id uuid, p_tickets jsonb, p_condition text, p_expected_total numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_total numeric(14,2); v_row public.tickets; v_result jsonb;
  v_results jsonb := '[]'::jsonb; v_changed integer := 0; v_action text;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_tickets IS NULL OR jsonb_typeof(p_tickets) <> 'array'
    OR p_condition IS NULL OR p_condition NOT IN ('pending','cash','yape')
    OR p_expected_total IS NULL OR p_expected_total < 0 OR p_expected_total::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Datos del pago conjunto invalidos' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_tickets) NOT BETWEEN 1 AND 2000 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_tickets) e WHERE jsonb_typeof(e) <> 'object'
      OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'updated_at') IS DISTINCT FROM 'string'
  ) THEN RAISE EXCEPTION 'Seleccion de tickets invalida' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) WHERE id IS NULL OR updated_at IS NULL OR NOT isfinite(updated_at))
    OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz)) <> jsonb_array_length(p_tickets) THEN
    RAISE EXCEPTION 'Tickets repetidos o versiones invalidas' USING ERRCODE='22023';
  END IF;
  -- Same lock order as the single-ticket operation; validate the whole selection before changing any row.
  PERFORM id FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  PERFORM t.id FROM public.tickets t JOIN jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) ON e.id=t.id ORDER BY t.id FOR UPDATE OF t;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count <> jsonb_array_length(p_tickets) THEN RAISE EXCEPTION 'No se encontraron todos los tickets' USING ERRCODE='P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.tickets t JOIN jsonb_to_recordset(p_tickets) e(id uuid,updated_at timestamptz) ON e.id=t.id
    WHERE t.student_id IS DISTINCT FROM p_student_id OR t.deleted_at IS NOT NULL OR t.is_available OR t.assignment_updated_at IS DISTINCT FROM e.updated_at) THEN
    RAISE EXCEPTION 'Las asignaciones o pagos cambiaron. Actualiza los tickets antes de continuar.' USING ERRCODE='P0001';
  END IF;
  -- Paid tickets are never charged again. Pending reverses only the selected payments.
  SELECT coalesce(sum(CASE WHEN p_condition='pending' AND t.is_paid THEN coalesce(p.amount,l.amount,t.unit_price)
    WHEN p_condition<>'pending' AND NOT t.is_paid THEN t.unit_price ELSE 0 END),0)
    INTO v_total FROM public.tickets t LEFT JOIN public.faculty_payments p ON p.id=t.payment_id LEFT JOIN public.legacy_ticket_payments l ON l.ticket_id=t.id
    WHERE t.id IN (SELECT id FROM jsonb_to_recordset(p_tickets) e(id uuid));
  IF v_total IS DISTINCT FROM p_expected_total THEN
    RAISE EXCEPTION 'El importe cambio. Actualiza los tickets y confirma nuevamente el total.' USING ERRCODE='P0001';
  END IF;
  FOR v_row IN SELECT t.* FROM public.tickets t JOIN jsonb_to_recordset(p_tickets) e(id uuid) ON e.id=t.id ORDER BY t.id LOOP
    v_action:=CASE WHEN p_condition='pending' AND v_row.is_paid THEN 'void'
      WHEN p_condition<>'pending' AND NOT v_row.is_paid THEN 'pay' ELSE NULL END;
    IF v_action IS NOT NULL THEN
      v_result:=public.set_faculty_ticket_payment(v_row.id,p_student_id,v_action,
        CASE WHEN v_action='pay' THEN p_condition ELSE NULL END,v_row.assignment_updated_at);
      v_results:=v_results || jsonb_build_array(v_result->'ticket'); v_changed:=v_changed+1;
    ELSE
      v_results:=v_results || jsonb_build_array(to_jsonb(v_row)||jsonb_build_object('can_manage',true,'can_edit',NOT(v_row.is_paid OR v_row.is_extra OR v_row.is_picked_up OR v_row.movement_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.ticket_movements WHERE ticket_ids @> ARRAY[v_row.id]))));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('studentId',p_student_id,'tickets',v_results,'condition',p_condition,
    'changed',v_changed,'unchanged',v_count-v_changed,'total',v_total);
END $$;
REVOKE ALL ON FUNCTION public.set_faculty_ticket_payments(uuid,jsonb,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_faculty_ticket_payments(uuid,jsonb,text,numeric) TO authenticated;


CREATE OR REPLACE FUNCTION public.snapshot_delivery_tickets(p_ids uuid[],p_newly_paid uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('student_name',s.name,'student_code',s.code,
  'collected_now',CASE WHEN t.id=ANY(p_newly_paid) THEN t.paid_amount ELSE 0 END,'was_prepaid',NOT(t.id=ANY(p_newly_paid))) ORDER BY t.ticket_number),'[]'::jsonb)
 FROM public.tickets t LEFT JOIN public.students s ON s.id=t.student_id WHERE t.id=ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.snapshot_delivery_tickets(uuid[],uuid[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.deliver_tickets(p_ticket_ids uuid[],p_payment_method text,p_expected_tickets jsonb)
RETURNS SETOF public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;v_id uuid:=gen_random_uuid();v_time timestamptz:=clock_timestamp();v_ticket public.tickets;v_payment uuid;v_new uuid[];v_email text:=auth.jwt()->>'email';
BEGIN
 PERFORM public.require_ticket_operator();
 IF p_ticket_ids IS NULL OR cardinality(p_ticket_ids) NOT BETWEEN 1 AND 2000
  OR (SELECT count(DISTINCT id) FROM unnest(p_ticket_ids) id)<>cardinality(p_ticket_ids)
  OR (p_payment_method IS NOT NULL AND p_payment_method NOT IN('cash','yape'))
  OR p_expected_tickets IS NULL OR jsonb_typeof(p_expected_tickets)<>'array' THEN RAISE EXCEPTION 'Entrega invalida' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_expected_tickets)<>cardinality(p_ticket_ids)
  OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_expected_tickets) e(id uuid,updated_at timestamptz))<>cardinality(p_ticket_ids)
  OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_expected_tickets) e(id uuid,updated_at timestamptz) WHERE id IS NULL OR updated_at IS NULL OR NOT isfinite(updated_at) OR NOT(id=ANY(p_ticket_ids))) THEN RAISE EXCEPTION 'Versiones de tickets invalidas' USING ERRCODE='22023'; END IF;
 PERFORM s.id FROM public.students s WHERE s.id IN(SELECT student_id FROM public.tickets WHERE id=ANY(p_ticket_ids)) ORDER BY s.id FOR UPDATE;
 PERFORM t.id FROM public.tickets t WHERE t.id=ANY(p_ticket_ids) ORDER BY t.id FOR UPDATE;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>cardinality(p_ticket_ids) THEN RAISE EXCEPTION 'No se encontraron todos los tickets' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.tickets t LEFT JOIN public.students s ON s.id=t.student_id JOIN jsonb_to_recordset(p_expected_tickets) e(id uuid,updated_at timestamptz) ON e.id=t.id
  WHERE t.deleted_at IS NOT NULL OR t.is_available OR t.is_picked_up OR t.assignment_updated_at IS DISTINCT FROM e.updated_at
    OR (t.student_id IS NULL AND NOT t.is_extra) OR (t.student_id IS NOT NULL AND (s.id IS NULL OR s.deleted_at IS NOT NULL))) THEN
  RAISE EXCEPTION 'Los tickets cambiaron, fueron retirados o ya se entregaron. Actualiza la seleccion.' USING ERRCODE='P0001'; END IF;
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_new FROM public.tickets WHERE id=ANY(p_ticket_ids) AND NOT is_paid;
 IF cardinality(v_new)>0 AND p_payment_method IS NULL THEN RAISE EXCEPTION 'Indica efectivo o Yape para los tickets pendientes de pago' USING ERRCODE='22023'; END IF;
 FOR v_ticket IN SELECT * FROM public.tickets WHERE id=ANY(v_new) ORDER BY id LOOP
  IF v_ticket.unit_price<=0 OR v_ticket.unit_price::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Precio de ticket invalido' USING ERRCODE='22023'; END IF;
  v_payment:=gen_random_uuid();
  INSERT INTO public.faculty_payments(id,ticket_id,kind,amount,method,created_at,actor_id,actor_email,ticket_snapshot)
   VALUES(v_payment,v_ticket.id,'payment',v_ticket.unit_price,p_payment_method,v_time,auth.uid(),v_email,
    to_jsonb(v_ticket)||jsonb_build_object('source','delivery','student_name',(SELECT name FROM public.students WHERE id=v_ticket.student_id),'student_code',(SELECT code FROM public.students WHERE id=v_ticket.student_id)));
  UPDATE public.tickets SET is_paid=true,payment_method=(CASE p_payment_method WHEN 'cash' THEN 'en_momento_efectivo' ELSE 'en_momento_yape' END)||'|'||coalesce(v_email,''),
    paid_amount=v_ticket.unit_price,paid_at=v_time,paid_by=auth.uid(),paid_by_email=v_email,payment_id=v_payment WHERE id=v_ticket.id;
 END LOOP;
 INSERT INTO public.ticket_movements(id,kind,created_at,actor_id,actor_email,payment_method,ticket_ids,ticket_snapshots)
  VALUES(v_id,'pickup',v_time,auth.uid(),v_email,CASE WHEN cardinality(v_new)>0 THEN CASE p_payment_method WHEN 'cash' THEN 'en_momento_efectivo' ELSE 'en_momento_yape' END ELSE NULL END,p_ticket_ids,public.snapshot_delivery_tickets(p_ticket_ids,v_new));
 RETURN QUERY UPDATE public.tickets SET is_picked_up=true,picked_up_at=v_time,picked_up_by=auth.uid(),movement_id=v_id WHERE id=ANY(p_ticket_ids) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.undo_delivery(p_ticket_ids uuid[],p_movement_id uuid) RETURNS SETOF public.tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 PERFORM public.require_ticket_operator();
 IF p_movement_id IS NULL OR p_ticket_ids IS NULL OR cardinality(p_ticket_ids) NOT BETWEEN 1 AND 2000
  OR (SELECT count(DISTINCT id) FROM unnest(p_ticket_ids) id)<>cardinality(p_ticket_ids) THEN RAISE EXCEPTION 'Anulacion invalida' USING ERRCODE='22023'; END IF;
 PERFORM s.id FROM public.students s WHERE s.id IN(SELECT student_id FROM public.tickets WHERE id=ANY(p_ticket_ids)) ORDER BY s.id FOR UPDATE;
 PERFORM t.id FROM public.tickets t WHERE t.id=ANY(p_ticket_ids) ORDER BY t.id FOR UPDATE;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>cardinality(p_ticket_ids) OR EXISTS(SELECT 1 FROM public.tickets WHERE id=ANY(p_ticket_ids) AND (deleted_at IS NOT NULL OR NOT is_picked_up OR movement_id IS DISTINCT FROM p_movement_id)) THEN
  RAISE EXCEPTION 'La entrega cambio. Actualiza el historial antes de anularla.' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.ticket_movements(kind,actor_id,actor_email,ticket_ids,ticket_snapshots)
  VALUES('undo',auth.uid(),auth.jwt()->>'email',p_ticket_ids,public.snapshot_delivery_tickets(p_ticket_ids));
 -- Anular entrega conserva pago, medio, importe y fecha; los reversos monetarios son otra operacion.
 RETURN QUERY UPDATE public.tickets SET is_picked_up=false,picked_up_at=NULL,picked_up_by=NULL,movement_id=NULL WHERE id=ANY(p_ticket_ids) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.ticket_cash_events() RETURNS TABLE(event_id uuid,ticket_id uuid,kind text,amount numeric,method text,created_at timestamptz,actor_email text,snapshot jsonb,source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id,p.ticket_id,p.kind,CASE WHEN p.kind='void' THEN -p.amount ELSE p.amount END,p.method,p.created_at,p.actor_email,p.ticket_snapshot,coalesce(p.ticket_snapshot->>'source','distribution') FROM public.faculty_payments p
 UNION ALL SELECT l.ticket_id,l.ticket_id,'payment',l.amount,l.method,l.paid_at,l.actor_email,l.snapshot,'legacy' FROM public.legacy_ticket_payments l;
$$;
REVOKE ALL ON FUNCTION public.ticket_cash_events() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.delivery_stats(p_date date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;v_cash jsonb;v_start timestamptz:=p_date::timestamp AT TIME ZONE 'America/Lima';v_end timestamptz:=(p_date+1)::timestamp AT TIME ZONE 'America/Lima';
BEGIN
 PERFORM public.require_ticket_operator();IF p_date IS NULL THEN RAISE EXCEPTION 'Fecha invalida' USING ERRCODE='22023'; END IF;
 WITH active AS MATERIALIZED (SELECT t.* FROM public.tickets t LEFT JOIN public.students s ON s.id=t.student_id WHERE t.deleted_at IS NULL AND NOT t.is_available AND ((t.student_id IS NOT NULL AND s.deleted_at IS NULL) OR t.is_extra)),
 owners AS (SELECT student_id,bool_and(is_picked_up) completed FROM active WHERE student_id IS NOT NULL GROUP BY student_id)
 SELECT jsonb_build_object('date',p_date,'totalTickets',count(*),'pickedUp',count(*) FILTER(WHERE is_picked_up),'pending',count(*) FILTER(WHERE NOT is_picked_up),
  'extraTickets',count(*) FILTER(WHERE is_extra AND NOT is_picked_up),'totalStudents',(SELECT count(*) FROM owners),'pendingStudents',(SELECT count(*) FROM owners WHERE NOT completed),'completedStudents',(SELECT count(*) FROM owners WHERE completed)) INTO v_result FROM active;
 SELECT jsonb_build_object('collectedTotal',coalesce(sum(amount),0),'collectedCashTotal',coalesce(sum(amount) FILTER(WHERE method='cash'),0),
  'collectedYapeTotal',coalesce(sum(amount) FILTER(WHERE method='yape'),0),'collectedOtherTotal',coalesce(sum(amount) FILTER(WHERE method='legacy'),0),
  'collectedNow',coalesce(sum(amount) FILTER(WHERE created_at>=v_start AND created_at<v_end),0),
  'collectedCash',coalesce(sum(amount) FILTER(WHERE method='cash' AND created_at>=v_start AND created_at<v_end),0),
  'collectedYape',coalesce(sum(amount) FILTER(WHERE method='yape' AND created_at>=v_start AND created_at<v_end),0),
  'legacyWithoutDate',count(*) FILTER(WHERE created_at IS NULL)) INTO v_cash FROM public.ticket_cash_events();
 RETURN v_result||v_cash;
END $$;

CREATE OR REPLACE FUNCTION public.delivery_cash_report(p_date date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_summary jsonb;v_start timestamptz:=p_date::timestamp AT TIME ZONE 'America/Lima';v_end timestamptz:=(p_date+1)::timestamp AT TIME ZONE 'America/Lima';v_entries jsonb;
BEGIN
 v_summary:=public.delivery_stats(p_date);
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.event_id),'[]'::jsonb) INTO v_entries FROM public.ticket_cash_events() e WHERE e.created_at>=v_start AND e.created_at<v_end;
 RETURN jsonb_build_object('entries',v_entries,'summary',v_summary);
END $$;

CREATE OR REPLACE FUNCTION public.delivery_directory(p_query text DEFAULT '',p_status text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_number integer;v_tokens text[];v_result jsonb;
BEGIN
 PERFORM public.require_ticket_operator();
 IF p_query IS NULL OR length(p_query)>200 OR p_status IS NULL OR p_status NOT IN('all','pending','completed') OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Filtros invalidos' USING ERRCODE='22023'; END IF;
 IF btrim(p_query) ~ '^#?[0-9]{1,10}$' AND ltrim(btrim(p_query),'#')::numeric<=2147483647 THEN v_number:=ltrim(btrim(p_query),'#')::integer; END IF;
 v_tokens:=regexp_split_to_array(public.faculty_search_key(btrim(p_query)),'\s+');
 WITH active AS MATERIALIZED (SELECT * FROM public.tickets WHERE deleted_at IS NULL AND NOT is_available AND student_id IS NOT NULL),
 roster AS (SELECT s.*,c.pending,c.exact FROM public.students s JOIN LATERAL(SELECT count(*) FILTER(WHERE NOT t.is_picked_up) pending,bool_or(t.ticket_number=v_number) exact FROM active t WHERE t.student_id=s.id HAVING count(*)>0)c ON true WHERE s.deleted_at IS NULL),
 matches AS MATERIALIZED (SELECT * FROM roster s WHERE (p_status='all' OR (p_status='pending' AND pending>0) OR (p_status='completed' AND pending=0))
  AND (coalesce(exact,false) OR NOT EXISTS(SELECT 1 FROM unnest(v_tokens) token WHERE strpos(public.faculty_search_key(s.name||' '||coalesce(s.code,'')||' '||coalesce(s.dni,'')),token)=0))),
 page_rows AS (SELECT * FROM matches ORDER BY coalesce(exact,false) DESC,public.faculty_search_key(name),id LIMIT p_page_size OFFSET (p_page-1)*p_page_size)
 SELECT jsonb_build_object('students',coalesce((SELECT jsonb_agg((to_jsonb(p)-ARRAY['pending','exact'])||jsonb_build_object('tickets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY ticket_number) FROM active t WHERE t.student_id=p.id)) ORDER BY coalesce(exact,false) DESC,public.faculty_search_key(name),id) FROM page_rows p),'[]'::jsonb),
 'total',(SELECT count(*) FROM matches),'hasMore',p_page::bigint*p_page_size<(SELECT count(*) FROM matches),'page',p_page,'pageSize',p_page_size) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.deliver_tickets(uuid[],text,jsonb),public.undo_delivery(uuid[],uuid),public.delivery_stats(date),public.delivery_cash_report(date),public.delivery_directory(text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.deliver_tickets(uuid[],text,jsonb),public.undo_delivery(uuid[],uuid),public.delivery_stats(date),public.delivery_cash_report(date),public.delivery_directory(text,text,integer,integer) TO authenticated;
-- No basta con conservar el numero de filas: comparar propietarios, numeros, fechas, pagos e instantaneas.
DO $verify_existing_data$
DECLARE v_table text;v_changed boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments'] LOOP
    EXECUTE format($verify_query$
      SELECT EXISTS(
        SELECT 1 FROM (
          SELECT id,original FROM pg_temp.kikiri_delivery_install_before WHERE entity=$1
        ) b FULL JOIN (
          SELECT t.id,to_jsonb(t) AS current_data FROM public.%I t
        ) a ON a.id=b.id
        WHERE b.id IS NULL OR a.id IS NULL OR EXISTS(
          SELECT 1 FROM jsonb_each(b.original) f WHERE a.current_data->f.key IS DISTINCT FROM f.value
        ) OR EXISTS(
          SELECT 1 FROM jsonb_each(a.current_data) f WHERE NOT(b.original ? f.key) AND f.value IS DISTINCT FROM 'null'::jsonb
        )
      )
    $verify_query$,v_table) INTO v_changed USING v_table;
    IF v_changed THEN
      RAISE EXCEPTION 'Verificacion fallida: cambiaron datos de %. Se cancela toda la migracion.',v_table USING ERRCODE='P0001';
    END IF;
  END LOOP;
  RAISE NOTICE 'Asignaciones, propietarios de tickets, estudiantes, pagos e historial originales verificados sin cambios.';
END $verify_existing_data$;
SELECT 'Asignaciones y datos existentes conservados; funciones habilitadas' AS resultado,
  (SELECT count(*) FROM pg_temp.kikiri_delivery_install_before WHERE entity='ticket_assignments') AS asignaciones_antes,
  (SELECT count(*) FROM public.ticket_assignments) AS asignaciones_despues,
  (SELECT count(*) FROM pg_temp.kikiri_delivery_install_before WHERE entity='tickets') AS tickets_antes,
  (SELECT count(*) FROM public.tickets) AS tickets_despues,
  (SELECT count(*) FROM pg_temp.kikiri_delivery_install_before WHERE entity='students') AS participantes_antes,
  (SELECT count(*) FROM public.students) AS participantes_despues;

NOTIFY pgrst,'reload schema';
COMMIT;
