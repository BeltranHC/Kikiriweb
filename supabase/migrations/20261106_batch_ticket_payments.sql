-- Pago conjunto de tickets existentes. Requiere 20261105_distribution_payments_deletion.sql.
-- Instalar solo define la funcion; no ejecuta pagos ni cambia asignaciones existentes.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- La instalacion no llama a las funciones de eliminar, pagar, anular ni reasignar.
-- Guardar cada fila original y verificarla antes de confirmar. Las copias son temporales.
CREATE TEMP TABLE pg_temp.kikiri_batch_install_before (
  entity text NOT NULL, id uuid NOT NULL, original jsonb NOT NULL, PRIMARY KEY(entity,id)
) ON COMMIT DROP;
ALTER TABLE pg_temp.kikiri_batch_install_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_batch_install_before FROM PUBLIC,anon,authenticated,service_role;
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
    EXECUTE format('INSERT INTO pg_temp.kikiri_batch_install_before(entity,id,original) SELECT $1,t.id,to_jsonb(t) FROM public.%I t',v_table) USING v_table;
  END LOOP;
END $capture_existing_data$;

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
  SELECT coalesce(sum(CASE WHEN p_condition='pending' AND t.is_paid THEN coalesce(p.amount,t.unit_price)
    WHEN p_condition<>'pending' AND NOT t.is_paid THEN t.unit_price ELSE 0 END),0)
    INTO v_total FROM public.tickets t LEFT JOIN public.faculty_payments p ON p.id=t.payment_id
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

-- No basta con conservar el numero de filas: comparar propietarios, numeros, fechas, pagos e instantaneas.
DO $verify_existing_data$
DECLARE v_table text;v_changed boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments'] LOOP
    EXECUTE format($verify_query$
      SELECT EXISTS(
        SELECT 1 FROM (
          SELECT id,original FROM pg_temp.kikiri_batch_install_before WHERE entity=$1
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
  (SELECT count(*) FROM pg_temp.kikiri_batch_install_before WHERE entity='ticket_assignments') AS asignaciones_antes,
  (SELECT count(*) FROM public.ticket_assignments) AS asignaciones_despues,
  (SELECT count(*) FROM pg_temp.kikiri_batch_install_before WHERE entity='tickets') AS tickets_antes,
  (SELECT count(*) FROM public.tickets) AS tickets_despues,
  (SELECT count(*) FROM pg_temp.kikiri_batch_install_before WHERE entity='students') AS participantes_antes,
  (SELECT count(*) FROM public.students) AS participantes_despues;

NOTIFY pgrst,'reload schema';
COMMIT;
