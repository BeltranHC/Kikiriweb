-- Pagos al repartir y eliminaciones con historial para todas las cuentas autenticadas.
-- Ejecutar despues de 20261104_semester_progress.sql. No elimina registros existentes.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS deleted_by_email text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS deleted_by_email text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2);
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_by uuid;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_by_email text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS payment_id uuid;
-- Los codigos siguen siendo unicos entre fichas activas; las eliminadas conservan su codigo original.
DROP INDEX IF EXISTS public.students_code_unique_idx;
CREATE UNIQUE INDEX students_code_unique_idx ON public.students((lower(btrim(code))))
  WHERE deleted_at IS NULL AND code IS NOT NULL AND btrim(code) <> '';
CREATE TABLE IF NOT EXISTS public.faculty_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.tickets(id),
  kind text NOT NULL CHECK(kind IN ('payment','void')), amount numeric(10,2) NOT NULL CHECK(amount > 0),
  method text NOT NULL CHECK(method IN ('cash','yape','legacy')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid NOT NULL, actor_email text, reverses_id uuid REFERENCES public.faculty_payments(id),
  is_legacy boolean NOT NULL DEFAULT false, ticket_snapshot jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS faculty_payments_reversal_idx ON public.faculty_payments(reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS faculty_payments_ticket_idx ON public.faculty_payments(ticket_id,created_at DESC,id);
ALTER TABLE public.faculty_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.faculty_payments TO authenticated;
GRANT ALL ON public.faculty_payments TO service_role;
DO $policy$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.faculty_payments'::regclass AND polname='authenticated_read_faculty_payments') THEN
    CREATE POLICY authenticated_read_faculty_payments ON public.faculty_payments FOR SELECT TO authenticated
      USING(auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'is_anonymous','false') <> 'true');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.tickets'::regclass AND conname='tickets_payment_id_fkey') THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_payment_id_fkey FOREIGN KEY(payment_id) REFERENCES public.faculty_payments(id);
  END IF;
END $policy$;

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
      v_method:=CASE split_part(v_ticket.payment_method,'|',1) WHEN 'en_momento' THEN 'cash' WHEN 'en_momento_efectivo' THEN 'cash' WHEN 'en_momento_yape' THEN 'yape' ELSE 'legacy' END;
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

CREATE OR REPLACE FUNCTION public.assign_faculty_tickets(p_student_id uuid,p_ticket_numbers integer[],p_payment_method text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;v_assignment uuid:=gen_random_uuid();v_conflicts text;v_count integer;v_ticket public.tickets;v_total numeric(10,2):=0;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_ticket_numbers IS NULL OR cardinality(p_ticket_numbers) NOT BETWEEN 1 AND 2000
    OR EXISTS(SELECT 1 FROM unnest(p_ticket_numbers)n WHERE n IS NULL OR n<1)
    OR (SELECT count(DISTINCT n) FROM unnest(p_ticket_numbers)n)<>cardinality(p_ticket_numbers)
    OR (p_payment_method IS NOT NULL AND p_payment_method NOT IN('cash','yape')) THEN
    RAISE EXCEPTION 'Asignacion invalida' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT string_agg(ticket_number::text,', ' ORDER BY ticket_number) INTO v_conflicts FROM
    (SELECT ticket_number FROM public.tickets WHERE ticket_number=ANY(p_ticket_numbers) AND NOT is_available ORDER BY ticket_number LIMIT 15)c;
  IF v_conflicts IS NOT NULL THEN RAISE EXCEPTION 'Estos tickets ya estan asignados o tienen historial: %. No se asigno ningun ticket.',v_conflicts USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ticket_assignments(id,student_id,student_name,student_code,semester,recipient_type,actor_id,actor_email,ticket_numbers)
    VALUES(v_assignment,v_student.id,v_student.name,v_student.code,v_student.semester,v_student.recipient_type,auth.uid(),auth.jwt()->>'email',ARRAY(SELECT n FROM unnest(p_ticket_numbers)n ORDER BY n));
  INSERT INTO public.tickets(ticket_number,student_id,assignment_id)
    SELECT n,v_student.id,v_assignment FROM unnest(p_ticket_numbers)n ORDER BY n
    ON CONFLICT(ticket_number) DO UPDATE SET student_id=excluded.student_id,assignment_id=excluded.assignment_id,is_available=false,deleted_at=NULL,deleted_by=NULL,deleted_by_email=NULL
      WHERE public.tickets.is_available;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>cardinality(p_ticket_numbers) THEN RAISE EXCEPTION 'Los tickets cambiaron de asignacion. Actualiza el padron.' USING ERRCODE='P0001'; END IF;
  IF p_payment_method IS NOT NULL THEN
    FOR v_ticket IN SELECT * FROM public.tickets WHERE assignment_id=v_assignment ORDER BY id LOOP
      PERFORM public.set_faculty_ticket_payment(v_ticket.id,v_student.id,'pay',p_payment_method,v_ticket.assignment_updated_at);
      v_total:=v_total+v_ticket.unit_price;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('assignmentId',v_assignment,'studentId',v_student.id,'studentName',v_student.name,'ticketsCreated',v_count,'paymentMethod',p_payment_method,'paymentTotal',v_total,
    'tickets',(SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('can_manage',true,'can_edit',NOT is_paid) ORDER BY ticket_number) FROM public.tickets t WHERE assignment_id=v_assignment));
END $$;
CREATE OR REPLACE FUNCTION public.assign_student_tickets(p_student_id uuid,p_ticket_numbers integer[]) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$SELECT public.assign_faculty_tickets(p_student_id,p_ticket_numbers,NULL)$$;

CREATE OR REPLACE FUNCTION public.delete_faculty_ticket(p_ticket_id uuid,p_student_id uuid,p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;v_available boolean;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_id IS NULL OR p_student_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Eliminacion invalida' USING ERRCODE='22023'; END IF;
  PERFORM id FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_ticket.student_id IS DISTINCT FROM p_student_id OR v_ticket.assignment_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Otro usuario modifico este ticket. Actualiza el padron.' USING ERRCODE='P0001';
  END IF;
  IF v_ticket.is_paid THEN RAISE EXCEPTION 'Anula el pago de este ticket antes de eliminarlo.' USING ERRCODE='P0001'; END IF;
  v_available:=NOT(v_ticket.is_extra OR v_ticket.is_picked_up OR v_ticket.movement_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.ticket_movements WHERE ticket_ids @> ARRAY[p_ticket_id]));
  UPDATE public.tickets SET student_id=NULL,assignment_id=NULL,is_available=v_available,deleted_at=clock_timestamp(),deleted_by=auth.uid(),deleted_by_email=auth.jwt()->>'email'
    WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('ticket',to_jsonb(v_ticket)||jsonb_build_object('can_edit',false,'can_manage',false),'action','delete','previousStudentId',p_student_id);
END $$;

CREATE OR REPLACE FUNCTION public.delete_faculty_recipient(p_student_id uuid,p_expected_updated_at timestamptz,p_expected_tickets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;v_ticket public.tickets;v_count integer;v_expected integer;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_expected_updated_at IS NULL OR p_expected_tickets IS NULL OR jsonb_typeof(p_expected_tickets)<>'array' THEN
    RAISE EXCEPTION 'Eliminacion de participante invalida' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_expected_tickets)>10000 THEN RAISE EXCEPTION 'Demasiados tickets' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_student FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_student.roster_updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'La ficha cambio. Actualiza el padron antes de eliminarla.' USING ERRCODE='P0001'; END IF;
  PERFORM id FROM public.tickets WHERE student_id=p_student_id AND deleted_at IS NULL ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  SELECT count(DISTINCT e.id) INTO v_expected FROM jsonb_to_recordset(p_expected_tickets) AS e(id uuid,updated_at timestamptz);
  IF v_expected<>jsonb_array_length(p_expected_tickets) OR v_expected<>v_count OR EXISTS(
    SELECT 1 FROM public.tickets t WHERE t.student_id=p_student_id AND t.deleted_at IS NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset(p_expected_tickets) AS e(id uuid,updated_at timestamptz) WHERE e.id=t.id AND e.updated_at=t.assignment_updated_at
    )
  ) THEN RAISE EXCEPTION 'Las asignaciones o pagos cambiaron. Actualiza el padron antes de eliminar.' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.tickets WHERE student_id=p_student_id AND deleted_at IS NULL AND is_paid) THEN
    RAISE EXCEPTION 'Anula primero los pagos de los tickets asignados a este participante.' USING ERRCODE='P0001';
  END IF;
  FOR v_ticket IN SELECT * FROM public.tickets WHERE student_id=p_student_id AND deleted_at IS NULL ORDER BY id LOOP
    PERFORM public.delete_faculty_ticket(v_ticket.id,p_student_id,v_ticket.assignment_updated_at);
  END LOOP;
  UPDATE public.students SET deleted_at=clock_timestamp(),deleted_by=auth.uid(),deleted_by_email=auth.jwt()->>'email' WHERE id=p_student_id;
  RETURN jsonb_build_object('studentId',p_student_id,'ticketsRemoved',v_count);
END $$;

CREATE OR REPLACE FUNCTION public.record_faculty_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_before jsonb;v_after jsonb;v_student uuid;v_person jsonb;v_name text;
BEGIN
  IF TG_OP<>'INSERT' THEN v_before:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN v_after:=to_jsonb(NEW); END IF;
  IF v_before IS NOT DISTINCT FROM v_after THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='students' THEN
    v_student:=coalesce((v_after->>'id')::uuid,(v_before->>'id')::uuid);v_name:=coalesce(v_after->>'name',v_before->>'name');
  ELSE
    IF v_before IS NOT NULL THEN
      SELECT jsonb_build_object('student_name',s.name,'student_code',s.code,'recipient_type',s.recipient_type) INTO v_person FROM public.students s WHERE s.id=(v_before->>'student_id')::uuid;
      v_before:=v_before || coalesce(v_person,'{}'::jsonb);
    END IF;
    IF v_after IS NOT NULL THEN
      SELECT jsonb_build_object('student_name',s.name,'student_code',s.code,'recipient_type',s.recipient_type) INTO v_person FROM public.students s WHERE s.id=(v_after->>'student_id')::uuid;
      v_after:=v_after || coalesce(v_person,'{}'::jsonb);
    END IF;
    v_student:=coalesce((v_after->>'student_id')::uuid,(v_before->>'student_id')::uuid);
    v_name:=coalesce(v_after->>'student_name',v_before->>'student_name');
  END IF;
  INSERT INTO public.faculty_changes(actor_id,actor_email,entity_type,entity_id,operation,student_id,student_name,before_data,after_data)
    VALUES(auth.uid(),auth.jwt()->>'email',CASE WHEN TG_TABLE_NAME='students' THEN 'student' ELSE 'ticket' END,
      coalesce((v_after->>'id')::uuid,(v_before->>'id')::uuid),CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN CASE WHEN v_before->>'deleted_at' IS NULL AND v_after->>'deleted_at' IS NOT NULL THEN 'delete' ELSE 'update' END ELSE 'delete' END,v_student,v_name,v_before,v_after);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.stamp_faculty_change(),public.record_faculty_change() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER stamp_faculty_student BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.stamp_faculty_change();
CREATE OR REPLACE TRIGGER stamp_faculty_ticket BEFORE INSERT OR UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.stamp_faculty_change();
CREATE OR REPLACE TRIGGER audit_faculty_student AFTER INSERT OR UPDATE OR DELETE ON public.students FOR EACH ROW EXECUTE FUNCTION public.record_faculty_change();
CREATE OR REPLACE TRIGGER audit_faculty_ticket AFTER INSERT OR UPDATE OR DELETE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.record_faculty_change();


CREATE OR REPLACE FUNCTION public.save_faculty_recipient(
  p_name text,p_code text,p_semester integer DEFAULT NULL,p_school text DEFAULT NULL,
  p_student_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_recipient_type text DEFAULT 'student'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_recipient_type IS NULL OR p_recipient_type NOT IN ('student','external','teacher') OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR length(coalesce(p_school,''))>120 OR length(coalesce(p_code,''))>50
    OR (nullif(btrim(p_code),'') IS NOT NULL AND btrim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
    OR (p_recipient_type='student' AND (nullif(btrim(p_code),'') IS NULL OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 1 AND 11)))
    OR (p_recipient_type<>'student' AND p_semester IS NOT NULL) THEN
    RAISE EXCEPTION 'Datos de participante invalidos' USING ERRCODE='22023';
  END IF;
  IF p_student_id IS NULL THEN
    INSERT INTO public.students(name,code,semester,school,recipient_type) VALUES(btrim(p_name),nullif(upper(btrim(p_code)),''),p_semester,nullif(btrim(p_school),''),p_recipient_type) RETURNING * INTO v_student;
  ELSE
    SELECT * INTO v_student FROM public.students WHERE id=p_student_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
    IF p_expected_updated_at IS NULL OR v_student.roster_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Otro usuario modifico esta ficha. Actualiza el padron y vuelve a abrir el editor.' USING ERRCODE='P0001';
    END IF;
    UPDATE public.students SET name=btrim(p_name),code=nullif(upper(btrim(p_code)),''),semester=p_semester,school=nullif(btrim(p_school),''),recipient_type=p_recipient_type WHERE id=p_student_id RETURNING * INTO v_student;
  END IF;
  RETURN to_jsonb(v_student);
END $$;


CREATE OR REPLACE FUNCTION public.edit_faculty_ticket(
  p_ticket_id uuid,p_student_id uuid,p_action text,p_ticket_number integer DEFAULT NULL,p_destination_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;v_destination public.students;v_assignment uuid;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_id IS NULL OR p_student_id IS NULL OR p_action IS NULL OR p_action NOT IN ('update','transfer','release')
    OR p_expected_updated_at IS NULL OR (p_action='update' AND (p_ticket_number IS NULL OR p_ticket_number<1))
    OR (p_action='transfer' AND (p_destination_id IS NULL OR p_destination_id=p_student_id)) THEN
    RAISE EXCEPTION 'Correccion de ticket invalida' USING ERRCODE='22023';
  END IF;
  -- Same lock order as allocation: students first, then ticket rows.
  PERFORM id FROM public.students WHERE id IN(p_student_id,p_destination_id) AND deleted_at IS NULL ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_ticket.student_id IS DISTINCT FROM p_student_id OR v_ticket.assignment_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Otro usuario modifico este ticket. Actualiza el padron antes de continuar.' USING ERRCODE='P0001';
  END IF;
  IF v_ticket.is_available OR v_ticket.is_extra OR v_ticket.is_paid OR v_ticket.is_picked_up OR v_ticket.movement_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.ticket_movements WHERE ticket_ids @> ARRAY[p_ticket_id]) THEN
    RAISE EXCEPTION 'Este ticket tiene pagos o entregas registrados y no se puede modificar desde Reparto.' USING ERRCODE='P0001';
  END IF;
  IF p_action='update' THEN
    UPDATE public.tickets SET ticket_number=p_ticket_number WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  ELSIF p_action='release' THEN
    UPDATE public.tickets SET student_id=NULL,assignment_id=NULL,is_available=true WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  ELSE
    SELECT * INTO v_destination FROM public.students WHERE id=p_destination_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destinatario no encontrado' USING ERRCODE='P0002'; END IF;
    v_assignment:=gen_random_uuid();
    INSERT INTO public.ticket_assignments(id,student_id,student_name,student_code,semester,recipient_type,actor_id,actor_email,ticket_numbers)
      VALUES(v_assignment,v_destination.id,v_destination.name,v_destination.code,v_destination.semester,v_destination.recipient_type,auth.uid(),auth.jwt()->>'email',ARRAY[v_ticket.ticket_number]);
    UPDATE public.tickets SET student_id=p_destination_id,assignment_id=v_assignment WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  END IF;
  RETURN jsonb_build_object('ticket',to_jsonb(v_ticket)||jsonb_build_object('can_manage',true,'can_edit',NOT v_ticket.is_available),'action',p_action,'previousStudentId',p_student_id);
END $$;

CREATE OR REPLACE FUNCTION public.import_faculty_roster(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row jsonb; v_created integer := 0; v_existing integer := 0; v_id uuid; v_semester integer;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Padrón inválido' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'El padrón debe contener entre 1 y 1000 estudiantes' USING ERRCODE='22023'; END IF;
  IF (SELECT count(DISTINCT lower(btrim(value->>'code'))) FROM jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'El padrón contiene códigos vacíos o repetidos' USING ERRCODE='22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY lower(btrim(value->>'code')) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR (v_row->>'semester' IS NOT NULL AND v_row->>'semester' !~ '^[0-9]{1,2}$') THEN
      RAISE EXCEPTION 'Fila del padrón inválida' USING ERRCODE='22023';
    END IF;
    v_semester := (v_row->>'semester')::integer;
    PERFORM public.validate_faculty_student(v_row->>'name',v_row->>'code',v_semester,v_row->>'school');
    -- Una importacion general no reactiva fichas eliminadas. El alta manual puede reutilizar su codigo.
    IF EXISTS(SELECT 1 FROM public.students WHERE deleted_at IS NOT NULL AND lower(btrim(code))=lower(btrim(v_row->>'code'))) THEN
      v_existing:=v_existing+1; CONTINUE;
    END IF;
    INSERT INTO public.students(name,code,semester,school)
      VALUES(btrim(v_row->>'name'),upper(btrim(v_row->>'code')),v_semester,nullif(btrim(v_row->>'school'),''))
      ON CONFLICT ((lower(btrim(code)))) WHERE deleted_at IS NULL AND code IS NOT NULL AND btrim(code) <> '' DO NOTHING RETURNING id INTO v_id;
    IF FOUND THEN v_created := v_created+1; ELSE v_existing := v_existing+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('studentsCreated',v_created,'studentsExisting',v_existing,'total',jsonb_array_length(p_rows));
END $$;


CREATE OR REPLACE FUNCTION public.faculty_directory_v2(
  p_query text DEFAULT '', p_semester integer DEFAULT NULL,
  p_recipient_type text DEFAULT NULL, p_ticket_status text DEFAULT 'all',
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[]; v_result jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000
    OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR length(coalesce(p_query,'')) > 200
    OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 0 AND 11)
    OR (p_recipient_type IS NOT NULL AND p_recipient_type NOT IN ('student','external','teacher'))
    OR p_ticket_status IS NULL OR p_ticket_status NOT IN ('all','without','with') THEN
    RAISE EXCEPTION 'Filtros del padron invalidos' USING ERRCODE = '22023';
  END IF;
  v_tokens := regexp_split_to_array(public.faculty_search_key(btrim(coalesce(p_query,''))), '\s+');
  -- Contar cada propietario una sola vez; incluye los tickets antiguos de Promocion.
  -- Reutilizar este resultado para filtros y resumen, sin recorrer el historial.
  WITH ticket_counts AS MATERIALIZED (
    SELECT student_id, count(*) AS ticket_count FROM public.tickets
    WHERE student_id IS NOT NULL AND deleted_at IS NULL GROUP BY student_id
  ), roster AS MATERIALIZED (
    SELECT s.*, coalesce(c.ticket_count,0) AS ticket_count,
      public.faculty_search_key(s.name) AS search_name,
      public.faculty_search_key(s.code) AS search_code
    FROM public.students s LEFT JOIN ticket_counts c ON c.student_id = s.id WHERE s.deleted_at IS NULL
  ), matching AS MATERIALIZED (
    SELECT s.* FROM roster s
    WHERE (p_recipient_type IS NULL OR s.recipient_type = p_recipient_type)
      AND (p_semester IS NULL OR (s.recipient_type = 'student'
        AND ((p_semester = 0 AND s.semester IS NULL) OR s.semester = p_semester)))
      AND (p_ticket_status = 'all' OR (p_ticket_status = 'without' AND s.ticket_count = 0)
        OR (p_ticket_status = 'with' AND s.ticket_count > 0))
      AND NOT EXISTS (SELECT 1 FROM unnest(v_tokens) token
        WHERE strpos(s.search_name,token) = 0 AND strpos(s.search_code,token) = 0)
  ), page_rows AS (
    SELECT * FROM matching
    ORDER BY CASE recipient_type WHEN 'student' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,
      semester NULLS LAST, search_name, id
    LIMIT p_page_size OFFSET (p_page - 1) * p_page_size
  )
  SELECT jsonb_build_object(
    'students', coalesce((SELECT jsonb_agg(
      (to_jsonb(p) - ARRAY['ticket_count','search_name','search_code']) || jsonb_build_object(
        'can_delete',true, 'tickets', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'ticket_number', t.ticket_number, 'is_picked_up', t.is_picked_up,
          'assignment_id', t.assignment_id, 'assignment_updated_at', t.assignment_updated_at,
          'is_paid',t.is_paid,'paid_amount',t.paid_amount,'payment_method',t.payment_method,'unit_price',t.unit_price,'paid_at',t.paid_at,'paid_by_email',t.paid_by_email,'can_manage',true,
          'can_edit', CASE WHEN t.is_available OR t.is_extra OR t.is_paid OR t.is_picked_up OR t.movement_id IS NOT NULL THEN false
            ELSE NOT EXISTS (SELECT 1 FROM public.ticket_movements m WHERE m.ticket_ids @> ARRAY[t.id]) END
        ) ORDER BY t.ticket_number) FROM public.tickets t WHERE t.student_id = p.id AND t.deleted_at IS NULL), '[]'::jsonb)
      ) ORDER BY CASE p.recipient_type WHEN 'student' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,
        p.semester NULLS LAST, p.search_name, p.id) FROM page_rows p), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching), 'page', p_page, 'pageSize', p_page_size,
    'hasMore', p_page::bigint * p_page_size < (SELECT count(*) FROM matching),
    'semesters', coalesce((SELECT jsonb_agg(jsonb_build_object('semester',semester,'count',n,'withTickets',assigned,'withoutTickets',n-assigned) ORDER BY semester NULLS LAST)
      FROM (SELECT semester,count(*) n,count(*) FILTER (WHERE ticket_count > 0) assigned FROM roster WHERE recipient_type = 'student' GROUP BY semester) groups), '[]'::jsonb),
    'categories', coalesce((SELECT jsonb_agg(jsonb_build_object('type',recipient_type,'count',n,'withTickets',assigned,'withoutTickets',n-assigned) ORDER BY recipient_type)
      FROM (SELECT recipient_type,count(*) n,count(*) FILTER (WHERE ticket_count > 0) assigned FROM roster GROUP BY recipient_type) groups), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object('totalStudents',count(*),
      'withTickets',count(*) FILTER (WHERE ticket_count > 0),
      'withoutTickets',count(*) FILTER (WHERE ticket_count = 0),
      'totalAssignedTickets',coalesce(sum(ticket_count),0)) FROM roster)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.faculty_directory_v2(text,integer,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faculty_directory_v2(text,integer,text,text,integer,integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.save_faculty_student(p_name text,p_code text,p_semester integer DEFAULT NULL,p_school text DEFAULT NULL,p_student_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$SELECT public.save_faculty_recipient(p_name,p_code,p_semester,p_school,p_student_id,p_expected_updated_at,'student')$$;
CREATE OR REPLACE FUNCTION public.faculty_recipient_directory(p_query text DEFAULT '',p_semester integer DEFAULT NULL,p_recipient_type text DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$SELECT public.faculty_directory_v2(p_query,p_semester,p_recipient_type,'all',p_page,p_page_size)$$;
CREATE OR REPLACE FUNCTION public.faculty_directory(p_query text DEFAULT '',p_semester integer DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$SELECT public.faculty_directory_v2(p_query,p_semester,NULL,'all',p_page,p_page_size)$$;
REVOKE ALL ON FUNCTION public.set_faculty_ticket_payment(uuid,uuid,text,text,timestamptz),public.assign_faculty_tickets(uuid,integer[],text),public.delete_faculty_ticket(uuid,uuid,timestamptz),public.delete_faculty_recipient(uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_faculty_ticket_payment(uuid,uuid,text,text,timestamptz),public.assign_faculty_tickets(uuid,integer[],text),public.delete_faculty_ticket(uuid,uuid,timestamptz),public.delete_faculty_recipient(uuid,timestamptz,jsonb) TO authenticated;
SELECT 'Pagos y eliminaciones con historial habilitados' AS resultado;
NOTIFY pgrst,'reload schema';
COMMIT;
