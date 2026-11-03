-- Participantes, correcciones de tickets y registro de cambios.
-- Ejecutar despues de las migraciones de reparto, promocion e historial.
-- No borra alumnos, tickets, asignaciones, pagos ni movimientos anteriores.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'student';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS roster_updated_by uuid;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS roster_updated_by_email text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS assignment_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT false;
ALTER TABLE public.ticket_assignments ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'student';
DO $constraints$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='students_recipient_type_check' AND conrelid='public.students'::regclass) THEN
    ALTER TABLE public.students ADD CONSTRAINT students_recipient_type_check CHECK (recipient_type IN ('student','external','teacher') AND (recipient_type='student' OR semester IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tickets_available_check' AND conrelid='public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_available_check CHECK (NOT is_available OR (student_id IS NULL AND assignment_id IS NULL AND NOT is_extra AND NOT is_paid AND NOT is_picked_up AND movement_id IS NULL));
  END IF;
END $constraints$;
CREATE INDEX IF NOT EXISTS students_recipient_type_idx ON public.students(recipient_type,semester,name,id);
CREATE TABLE IF NOT EXISTS public.faculty_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid, actor_email text, entity_type text NOT NULL CHECK (entity_type IN ('student','ticket')),
  entity_id uuid NOT NULL, operation text NOT NULL CHECK (operation IN ('create','update','delete')),
  student_id uuid, student_name text, before_data jsonb, after_data jsonb
);
ALTER TABLE public.faculty_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.faculty_changes TO authenticated;
GRANT ALL ON public.faculty_changes TO service_role;
DO $policy$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.faculty_changes'::regclass AND polname='authenticated_read_changes') THEN
    CREATE POLICY authenticated_read_changes ON public.faculty_changes FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'is_anonymous','false') <> 'true');
  END IF;
END $policy$;
CREATE INDEX IF NOT EXISTS faculty_changes_created_idx ON public.faculty_changes(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS faculty_changes_student_idx ON public.faculty_changes(student_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.stamp_faculty_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='students' THEN
    NEW.roster_updated_at:=clock_timestamp(); NEW.roster_updated_by:=auth.uid(); NEW.roster_updated_by_email:=auth.jwt()->>'email';
  ELSE NEW.assignment_updated_at:=clock_timestamp(); END IF;
  RETURN NEW;
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
      coalesce((v_after->>'id')::uuid,(v_before->>'id')::uuid),CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,v_student,v_name,v_before,v_after);
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
    SELECT * INTO v_student FROM public.students WHERE id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
    IF p_expected_updated_at IS NULL OR v_student.roster_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Otro usuario modifico esta ficha. Actualiza el padron y vuelve a abrir el editor.' USING ERRCODE='P0001';
    END IF;
    UPDATE public.students SET name=btrim(p_name),code=nullif(upper(btrim(p_code)),''),semester=p_semester,school=nullif(btrim(p_school),''),recipient_type=p_recipient_type WHERE id=p_student_id RETURNING * INTO v_student;
  END IF;
  RETURN to_jsonb(v_student);
END $$;

CREATE OR REPLACE FUNCTION public.assign_student_tickets(p_student_id uuid,p_ticket_numbers integer[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;v_assignment uuid:=gen_random_uuid();v_conflicts text;v_count integer;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_ticket_numbers IS NULL OR cardinality(p_ticket_numbers) NOT BETWEEN 1 AND 2000
    OR EXISTS(SELECT 1 FROM unnest(p_ticket_numbers)n WHERE n IS NULL OR n<1)
    OR (SELECT count(DISTINCT n) FROM unnest(p_ticket_numbers)n)<>cardinality(p_ticket_numbers) THEN
    RAISE EXCEPTION 'Asignacion invalida' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT string_agg(ticket_number::text,', ' ORDER BY ticket_number) INTO v_conflicts FROM
    (SELECT ticket_number FROM public.tickets WHERE ticket_number=ANY(p_ticket_numbers) AND NOT is_available ORDER BY ticket_number LIMIT 15)c;
  IF v_conflicts IS NOT NULL THEN RAISE EXCEPTION 'Estos tickets ya estan asignados: %. No se asigno ningun ticket.',v_conflicts USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ticket_assignments(id,student_id,student_name,student_code,semester,recipient_type,actor_id,actor_email,ticket_numbers)
    VALUES(v_assignment,v_student.id,v_student.name,v_student.code,v_student.semester,v_student.recipient_type,auth.uid(),auth.jwt()->>'email',ARRAY(SELECT n FROM unnest(p_ticket_numbers)n ORDER BY n));
  INSERT INTO public.tickets(ticket_number,student_id,assignment_id)
    SELECT n,v_student.id,v_assignment FROM unnest(p_ticket_numbers)n ORDER BY n
    ON CONFLICT(ticket_number) DO UPDATE SET student_id=excluded.student_id,assignment_id=excluded.assignment_id,is_available=false
      WHERE public.tickets.is_available;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>cardinality(p_ticket_numbers) THEN RAISE EXCEPTION 'Los tickets cambiaron de asignacion. Actualiza el padron.' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('assignmentId',v_assignment,'studentId',v_student.id,'studentName',v_student.name,'ticketsCreated',v_count,
    'tickets',(SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('can_edit',true) ORDER BY ticket_number) FROM public.tickets t WHERE assignment_id=v_assignment));
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
  PERFORM id FROM public.students WHERE id IN(p_student_id,p_destination_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002'; END IF;
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
    SELECT * INTO v_destination FROM public.students WHERE id=p_destination_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destinatario no encontrado' USING ERRCODE='P0002'; END IF;
    v_assignment:=gen_random_uuid();
    INSERT INTO public.ticket_assignments(id,student_id,student_name,student_code,semester,recipient_type,actor_id,actor_email,ticket_numbers)
      VALUES(v_assignment,v_destination.id,v_destination.name,v_destination.code,v_destination.semester,v_destination.recipient_type,auth.uid(),auth.jwt()->>'email',ARRAY[v_ticket.ticket_number]);
    UPDATE public.tickets SET student_id=p_destination_id,assignment_id=v_assignment WHERE id=p_ticket_id RETURNING * INTO v_ticket;
  END IF;
  RETURN jsonb_build_object('ticket',to_jsonb(v_ticket)||jsonb_build_object('can_edit',NOT v_ticket.is_available),'action',p_action,'previousStudentId',p_student_id);
END $$;
CREATE OR REPLACE FUNCTION public.faculty_recipient_directory(p_query text DEFAULT '', p_semester integer DEFAULT NULL, p_recipient_type text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[]; v_total bigint; v_students jsonb; v_semesters jsonb; v_summary jsonb; v_categories jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR length(coalesce(p_query,'')) > 200 OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 0 AND 11) THEN
    RAISE EXCEPTION 'Filtros del padrón inválidos' USING ERRCODE='22023';
  END IF;
  IF p_recipient_type IS NOT NULL AND p_recipient_type NOT IN ('student','external','teacher') THEN RAISE EXCEPTION 'Categoria invalida' USING ERRCODE='22023'; END IF;
  v_tokens := regexp_split_to_array(public.faculty_search_key(btrim(coalesce(p_query,''))), '\s+');
  WITH matching AS (
    SELECT s.* FROM public.students s
    WHERE (p_recipient_type IS NULL OR s.recipient_type=p_recipient_type) AND (p_semester IS NULL OR (s.recipient_type='student' AND ((p_semester=0 AND s.semester IS NULL) OR s.semester=p_semester)))
      AND NOT EXISTS (SELECT 1 FROM unnest(v_tokens) token WHERE strpos(public.faculty_search_key(s.name),token)=0 AND strpos(public.faculty_search_key(s.code),token)=0)
  ), page_rows AS (
    SELECT * FROM matching ORDER BY CASE recipient_type WHEN 'student' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,semester NULLS LAST,public.faculty_search_key(name),id LIMIT p_page_size OFFSET (p_page-1)*p_page_size
  )
  SELECT (SELECT count(*) FROM matching),coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('tickets',
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'ticket_number',t.ticket_number,'is_picked_up',t.is_picked_up,'assignment_id',t.assignment_id,'assignment_updated_at',t.assignment_updated_at,'can_edit',NOT(t.is_available OR t.is_extra OR t.is_paid OR t.is_picked_up OR t.movement_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.ticket_movements m WHERE m.ticket_ids @> ARRAY[t.id]))) ORDER BY t.ticket_number)
      FROM public.tickets t WHERE t.student_id=p.id),'[]'::jsonb)) ORDER BY CASE p.recipient_type WHEN 'student' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,p.semester NULLS LAST,public.faculty_search_key(p.name),p.id),'[]'::jsonb)
    INTO v_total,v_students FROM page_rows p;
  SELECT coalesce(jsonb_agg(jsonb_build_object('semester',semester,'count',n) ORDER BY semester NULLS LAST),'[]'::jsonb)
    INTO v_semesters FROM (SELECT semester,count(*) n FROM public.students WHERE recipient_type='student' GROUP BY semester) grouped;
  SELECT jsonb_build_object('totalStudents',count(*),'withTickets',count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public.tickets t WHERE t.student_id=s.id)),
    'withoutTickets',count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.student_id=s.id))) INTO v_summary FROM public.students s;
  SELECT coalesce(jsonb_agg(jsonb_build_object('type',recipient_type,'count',n)),'[]'::jsonb) INTO v_categories FROM (SELECT recipient_type,count(*) n FROM public.students GROUP BY recipient_type)c;
  RETURN jsonb_build_object('categories',v_categories,'students',v_students,'total',v_total,'page',p_page,'pageSize',p_page_size,'hasMore',p_page::bigint*p_page_size<v_total,'semesters',v_semesters,'summary',v_summary);
END $$;


CREATE OR REPLACE FUNCTION public.faculty_change_history(p_query text DEFAULT '',p_from timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[];v_total bigint;v_rows jsonb;v_summary jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR length(coalesce(p_query,''))>200 OR (p_from IS NOT NULL AND p_until IS NOT NULL AND p_from>=p_until) THEN
    RAISE EXCEPTION 'Filtros de cambios invalidos' USING ERRCODE='22023';
  END IF;
  v_tokens:=regexp_split_to_array(public.faculty_search_key(btrim(coalesce(p_query,''))),'\s+');
  WITH matching AS (
    SELECT c.* FROM public.faculty_changes c WHERE (p_from IS NULL OR created_at>=p_from) AND (p_until IS NULL OR created_at<p_until)
    AND NOT EXISTS (SELECT 1 FROM unnest(v_tokens) token WHERE strpos(public.faculty_search_key(concat_ws(' ',c.student_name,c.actor_email,c.entity_id::text,c.before_data::text,c.after_data::text)),ltrim(token,'#'))=0)
  ), page_rows AS (SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page-1)*p_page_size)
  SELECT (SELECT count(*) FROM matching),coalesce(jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_total,v_rows FROM page_rows p;
  SELECT jsonb_build_object('changes',count(*),'profiles',count(*) FILTER(WHERE entity_type='student'),'tickets',count(*) FILTER(WHERE entity_type='ticket')) INTO v_summary FROM public.faculty_changes;
  RETURN jsonb_build_object('changes',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'hasMore',p_page::bigint*p_page_size<v_total,'summary',v_summary);
END $$;
REVOKE ALL ON FUNCTION public.save_faculty_recipient(text,text,integer,text,uuid,timestamptz,text),public.assign_student_tickets(uuid,integer[]),public.edit_faculty_ticket(uuid,uuid,text,integer,uuid,timestamptz),public.faculty_recipient_directory(text,integer,text,integer,integer),public.faculty_change_history(text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_faculty_recipient(text,text,integer,text,uuid,timestamptz,text),public.assign_student_tickets(uuid,integer[]),public.edit_faculty_ticket(uuid,uuid,text,integer,uuid,timestamptz),public.faculty_recipient_directory(text,integer,text,integer,integer),public.faculty_change_history(text,timestamptz,timestamptz,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
