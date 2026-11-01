-- Reparto a la facultad. Ejecutar después de database.sql.
-- Migración aditiva: conserva estudiantes, tickets, pagos y movimientos existentes.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS semester smallint;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS roster_updated_at timestamptz NOT NULL DEFAULT now();
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='students_semester_check' AND conrelid='public.students'::regclass) THEN
    ALTER TABLE public.students ADD CONSTRAINT students_semester_check CHECK (semester BETWEEN 1 AND 10);
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE code IS NOT NULL AND btrim(code) <> '' GROUP BY lower(btrim(code)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay códigos repetidos entre los estudiantes existentes. Revísalos antes de instalar el reparto; no se borró ningún registro.';
  END IF;
END $constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS students_code_unique_idx ON public.students ((lower(btrim(code)))) WHERE code IS NOT NULL AND btrim(code) <> '';
CREATE INDEX IF NOT EXISTS students_semester_name_idx ON public.students(semester, name, id);

CREATE TABLE IF NOT EXISTS public.ticket_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id),
  student_name text NOT NULL, student_code text, semester smallint,
  created_at timestamptz NOT NULL DEFAULT now(), actor_id uuid NOT NULL, actor_email text,
  ticket_numbers integer[] NOT NULL CHECK (cardinality(ticket_numbers) BETWEEN 1 AND 2000)
);
ALTER TABLE public.ticket_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_assignments TO authenticated;
GRANT ALL ON public.ticket_assignments TO service_role;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.ticket_assignments'::regclass AND polname='authenticated_read_assignments') THEN
    CREATE POLICY authenticated_read_assignments ON public.ticket_assignments FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'is_anonymous','false') <> 'true');
  END IF;
END $policy$;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS assignment_id uuid;
DO $assignment_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tickets_assignment_id_fkey' AND conrelid='public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.ticket_assignments(id);
  END IF;
END $assignment_fk$;
CREATE INDEX IF NOT EXISTS tickets_assignment_id_idx ON public.tickets(assignment_id);
CREATE INDEX IF NOT EXISTS ticket_assignments_student_idx ON public.ticket_assignments(student_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.faculty_search_key(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT translate(lower(coalesce(p_text,'')), 'áéíóúüñ', 'aeiouun');
$$;
REVOKE ALL ON FUNCTION public.faculty_search_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_faculty_student(p_name text, p_code text, p_semester integer, p_school text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 1 AND 50 OR btrim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 1 AND 10) OR length(coalesce(p_school,'')) > 120 THEN
    RAISE EXCEPTION 'Datos de estudiante o semestre inválidos' USING ERRCODE='22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_faculty_student(text,text,integer,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_faculty_student(
  p_name text, p_code text, p_semester integer DEFAULT NULL, p_school text DEFAULT NULL,
  p_student_id uuid DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;
BEGIN
  PERFORM public.require_ticket_operator();
  PERFORM public.validate_faculty_student(p_name,p_code,p_semester,p_school);
  IF p_student_id IS NULL THEN
    INSERT INTO public.students(name,code,semester,school)
      VALUES(btrim(p_name),upper(btrim(p_code)),p_semester,nullif(btrim(p_school),'')) RETURNING * INTO v_student;
  ELSE
    SELECT * INTO v_student FROM public.students WHERE id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Estudiante no encontrado' USING ERRCODE='P0002'; END IF;
    IF p_expected_updated_at IS NULL OR v_student.roster_updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Otro encargado modificó este estudiante. Actualiza el padrón y revisa sus datos antes de guardar.' USING ERRCODE='P0001';
    END IF;
    UPDATE public.students SET name=btrim(p_name),code=upper(btrim(p_code)),semester=p_semester,
      school=nullif(btrim(p_school),''),roster_updated_at=clock_timestamp()
      WHERE id=p_student_id RETURNING * INTO v_student;
  END IF;
  RETURN to_jsonb(v_student);
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
    INSERT INTO public.students(name,code,semester,school)
      VALUES(btrim(v_row->>'name'),upper(btrim(v_row->>'code')),v_semester,nullif(btrim(v_row->>'school'),''))
      ON CONFLICT ((lower(btrim(code)))) WHERE code IS NOT NULL AND btrim(code) <> '' DO NOTHING RETURNING id INTO v_id;
    IF FOUND THEN v_created := v_created+1; ELSE v_existing := v_existing+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('studentsCreated',v_created,'studentsExisting',v_existing,'total',jsonb_array_length(p_rows));
END $$;

CREATE OR REPLACE FUNCTION public.assign_student_tickets(p_student_id uuid, p_ticket_numbers integer[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students; v_assignment uuid := gen_random_uuid(); v_conflicts text;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_student_id IS NULL OR p_ticket_numbers IS NULL OR cardinality(p_ticket_numbers) NOT BETWEEN 1 AND 2000
    OR EXISTS(SELECT 1 FROM unnest(p_ticket_numbers) n WHERE n IS NULL OR n < 1)
    OR (SELECT count(DISTINCT n) FROM unnest(p_ticket_numbers) n) <> cardinality(p_ticket_numbers) THEN
    RAISE EXCEPTION 'Asignación de tickets inválida' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estudiante no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT string_agg(ticket_number::text,', ' ORDER BY ticket_number) INTO v_conflicts
    FROM (SELECT ticket_number FROM public.tickets WHERE ticket_number=ANY(p_ticket_numbers) ORDER BY ticket_number LIMIT 15) conflicts;
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Estos tickets ya están registrados: %. No se asignó ningún ticket del lote.',v_conflicts USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.ticket_assignments(id,student_id,student_name,student_code,semester,actor_id,actor_email,ticket_numbers)
    VALUES(v_assignment,v_student.id,v_student.name,v_student.code,v_student.semester,auth.uid(),auth.jwt()->>'email',
      ARRAY(SELECT n FROM unnest(p_ticket_numbers) n ORDER BY n));
  -- El índice único evita que dos encargados asignen el mismo número a la vez.
  -- El orden fijo de inserción evita interbloqueos entre lotes solapados.
  INSERT INTO public.tickets(ticket_number,student_id,assignment_id)
    SELECT n,v_student.id,v_assignment FROM unnest(p_ticket_numbers) n ORDER BY n;
  RETURN jsonb_build_object('assignmentId',v_assignment,'studentId',v_student.id,'studentName',v_student.name,
    'ticketsCreated',cardinality(p_ticket_numbers),'tickets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY ticket_number) FROM public.tickets t WHERE assignment_id=v_assignment));
END $$;

CREATE OR REPLACE FUNCTION public.faculty_directory(p_query text DEFAULT '', p_semester integer DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[]; v_total bigint; v_students jsonb; v_semesters jsonb; v_summary jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR length(coalesce(p_query,'')) > 200 OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 0 AND 10) THEN
    RAISE EXCEPTION 'Filtros del padrón inválidos' USING ERRCODE='22023';
  END IF;
  v_tokens := regexp_split_to_array(public.faculty_search_key(btrim(coalesce(p_query,''))), '\s+');
  WITH matching AS (
    SELECT s.* FROM public.students s
    WHERE (p_semester IS NULL OR (p_semester=0 AND s.semester IS NULL) OR s.semester=p_semester)
      AND NOT EXISTS (SELECT 1 FROM unnest(v_tokens) token WHERE strpos(public.faculty_search_key(s.name),token)=0 AND strpos(public.faculty_search_key(s.code),token)=0)
  ), page_rows AS (
    SELECT * FROM matching ORDER BY semester NULLS LAST,public.faculty_search_key(name),id LIMIT p_page_size OFFSET (p_page-1)*p_page_size
  )
  SELECT (SELECT count(*) FROM matching),coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('tickets',
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'ticket_number',t.ticket_number,'is_picked_up',t.is_picked_up,'assignment_id',t.assignment_id) ORDER BY t.ticket_number)
      FROM public.tickets t WHERE t.student_id=p.id),'[]'::jsonb)) ORDER BY p.semester NULLS LAST,public.faculty_search_key(p.name),p.id),'[]'::jsonb)
    INTO v_total,v_students FROM page_rows p;
  SELECT coalesce(jsonb_agg(jsonb_build_object('semester',semester,'count',n) ORDER BY semester NULLS LAST),'[]'::jsonb)
    INTO v_semesters FROM (SELECT semester,count(*) n FROM public.students GROUP BY semester) grouped;
  SELECT jsonb_build_object('totalStudents',count(*),'withTickets',count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public.tickets t WHERE t.student_id=s.id)),
    'withoutTickets',count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.student_id=s.id))) INTO v_summary FROM public.students s;
  RETURN jsonb_build_object('students',v_students,'total',v_total,'page',p_page,'pageSize',p_page_size,'hasMore',p_page::bigint*p_page_size<v_total,'semesters',v_semesters,'summary',v_summary);
END $$;

REVOKE ALL ON FUNCTION public.save_faculty_student(text,text,integer,text,uuid,timestamptz), public.import_faculty_roster(jsonb), public.assign_student_tickets(uuid,integer[]), public.faculty_directory(text,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_faculty_student(text,text,integer,text,uuid,timestamptz), public.import_faculty_roster(jsonb), public.assign_student_tickets(uuid,integer[]), public.faculty_directory(text,integer,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
