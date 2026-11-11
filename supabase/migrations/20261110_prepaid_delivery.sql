-- Prepagado en Entregas: confirmar un pago anterior sin registrar un nuevo cobro.
-- Requiere 20261110_enable_deliveries.sql. Ejecutar completo en el SQL Editor.
-- No entrega, elimina ni cambia ningun ticket al instalar. Conserva todos los datos.
BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE pg_temp.kikiri_prepaid_before (
  entity text NOT NULL, id uuid NOT NULL, original jsonb NOT NULL, PRIMARY KEY(entity,id)
) ON COMMIT DROP;
ALTER TABLE pg_temp.kikiri_prepaid_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_prepaid_before FROM PUBLIC,anon,authenticated,service_role;
DO $capture$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments','legacy_ticket_payments'] LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_table);
    EXECUTE format('INSERT INTO pg_temp.kikiri_prepaid_before(entity,id,original) SELECT $1,coalesce(to_jsonb(t)->>''id'',to_jsonb(t)->>''ticket_id'')::uuid,to_jsonb(t) FROM public.%I t',v_table) USING v_table;
  END LOOP;
END $capture$;
-- Se reemplazan solamente dos reglas de validacion. No se eliminan filas.
-- Efectivo, Yape y pagos antiguos exigen importe positivo; Prepagado exige cero.
ALTER TABLE public.faculty_payments DROP CONSTRAINT IF EXISTS faculty_payments_amount_check;
ALTER TABLE public.faculty_payments DROP CONSTRAINT IF EXISTS faculty_payments_method_check;
ALTER TABLE public.faculty_payments ADD CONSTRAINT faculty_payments_method_check CHECK(method IN('cash','yape','legacy','prepaid'));
ALTER TABLE public.faculty_payments ADD CONSTRAINT faculty_payments_amount_check
  CHECK((method='prepaid' AND amount=0) OR (method<>'prepaid' AND amount>0));

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
  IF v_amount IS NULL OR v_amount::text IN('NaN','Infinity','-Infinity') OR (v_method='prepaid' AND v_amount<>0) OR (v_method<>'prepaid' AND v_amount<=0) THEN RAISE EXCEPTION 'El precio del ticket requiere revision' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION public.deliver_tickets(p_ticket_ids uuid[],p_payment_method text,p_expected_tickets jsonb)
RETURNS SETOF public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;v_id uuid:=gen_random_uuid();v_time timestamptz:=clock_timestamp();v_ticket public.tickets;v_payment uuid;v_new uuid[];v_email text:=auth.jwt()->>'email';
BEGIN
 PERFORM public.require_ticket_operator();
 IF p_ticket_ids IS NULL OR cardinality(p_ticket_ids) NOT BETWEEN 1 AND 2000
  OR (SELECT count(DISTINCT id) FROM unnest(p_ticket_ids) id)<>cardinality(p_ticket_ids)
  OR (p_payment_method IS NOT NULL AND p_payment_method NOT IN('cash','yape','prepaid'))
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
 IF cardinality(v_new)>0 AND p_payment_method IS NULL THEN RAISE EXCEPTION 'Indica efectivo, Yape o Prepagado para los tickets pendientes de pago' USING ERRCODE='22023'; END IF;
 FOR v_ticket IN SELECT * FROM public.tickets WHERE id=ANY(v_new) ORDER BY id LOOP
  IF v_ticket.unit_price<=0 OR v_ticket.unit_price::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Precio de ticket invalido' USING ERRCODE='22023'; END IF;
  v_payment:=gen_random_uuid();
  INSERT INTO public.faculty_payments(id,ticket_id,kind,amount,method,created_at,actor_id,actor_email,ticket_snapshot)
   VALUES(v_payment,v_ticket.id,'payment',CASE WHEN p_payment_method='prepaid' THEN 0 ELSE v_ticket.unit_price END,p_payment_method,v_time,auth.uid(),v_email,
    to_jsonb(v_ticket)||jsonb_build_object('source','delivery','student_name',(SELECT name FROM public.students WHERE id=v_ticket.student_id),'student_code',(SELECT code FROM public.students WHERE id=v_ticket.student_id)));
  UPDATE public.tickets SET is_paid=true,payment_method=(CASE p_payment_method WHEN 'cash' THEN 'en_momento_efectivo' WHEN 'yape' THEN 'en_momento_yape' ELSE 'prepaid' END)||'|'||coalesce(v_email,''),
    paid_amount=CASE WHEN p_payment_method='prepaid' THEN 0 ELSE v_ticket.unit_price END,paid_at=v_time,paid_by=auth.uid(),paid_by_email=v_email,payment_id=v_payment WHERE id=v_ticket.id;
 END LOOP;
 INSERT INTO public.ticket_movements(id,kind,created_at,actor_id,actor_email,payment_method,ticket_ids,ticket_snapshots)
  VALUES(v_id,'pickup',v_time,auth.uid(),v_email,CASE WHEN cardinality(v_new)>0 THEN CASE p_payment_method WHEN 'cash' THEN 'en_momento_efectivo' WHEN 'yape' THEN 'en_momento_yape' ELSE 'prepaid' END ELSE NULL END,p_ticket_ids,public.snapshot_delivery_tickets(p_ticket_ids,v_new));
 RETURN QUERY UPDATE public.tickets SET is_picked_up=true,picked_up_at=v_time,picked_up_by=auth.uid(),movement_id=v_id WHERE id=ANY(p_ticket_ids) RETURNING *;
END $$;

-- Mantener los permisos restringidos a operadores autenticados.
REVOKE ALL ON FUNCTION public.deliver_tickets(uuid[],text,jsonb),public.set_faculty_ticket_payment(uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.deliver_tickets(uuid[],text,jsonb),public.set_faculty_ticket_payment(uuid,uuid,text,text,timestamptz) TO authenticated;
DO $verify$
DECLARE v_table text;v_changed boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments','legacy_ticket_payments'] LOOP
    EXECUTE format($compare$
      SELECT EXISTS(SELECT 1 FROM
        (SELECT id,original FROM pg_temp.kikiri_prepaid_before WHERE entity=$1) b
        FULL JOIN (SELECT coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'ticket_id')::uuid id,to_jsonb(t) current_data FROM public.%I t) a ON a.id=b.id
        WHERE b.id IS NULL OR a.id IS NULL OR b.original IS DISTINCT FROM a.current_data)
    $compare$,v_table) INTO v_changed USING v_table;
    IF v_changed THEN RAISE EXCEPTION 'Cambiaron datos de %. Se cancela toda la actualizacion.',v_table; END IF;
  END LOOP;
END $verify$;
SELECT 'Prepagado habilitado; asignaciones, pagos e historial conservados' AS resultado,
  (SELECT count(*) FROM pg_temp.kikiri_prepaid_before WHERE entity='ticket_assignments') AS asignaciones_antes,
  (SELECT count(*) FROM public.ticket_assignments) AS asignaciones_despues,
  (SELECT count(*) FROM pg_temp.kikiri_prepaid_before WHERE entity='tickets') AS tickets_antes,
  (SELECT count(*) FROM public.tickets) AS tickets_despues,
  (SELECT count(*) FROM pg_temp.kikiri_prepaid_before WHERE entity='faculty_payments') AS pagos_antes,
  (SELECT count(*) FROM public.faculty_payments) AS pagos_despues;
NOTIFY pgrst,'reload schema';
COMMIT;
