-- Añade la categoría Promoción (11) sin convertir registros automáticamente.
-- Los semestres I-X siguen siendo 1-10 y los pendientes siguen siendo NULL.
-- Ejecutar después de 20261031_faculty_distribution.sql.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_semester_check;
ALTER TABLE public.students ADD CONSTRAINT students_semester_check CHECK (semester BETWEEN 1 AND 11);

CREATE OR REPLACE FUNCTION public.validate_faculty_student(p_name text, p_code text, p_semester integer, p_school text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 1 AND 50 OR btrim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 1 AND 11) OR length(coalesce(p_school,'')) > 120 THEN
    RAISE EXCEPTION 'Datos de estudiante o semestre inválidos' USING ERRCODE='22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_faculty_student(text,text,integer,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.faculty_directory(p_query text DEFAULT '', p_semester integer DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[]; v_total bigint; v_students jsonb; v_semesters jsonb; v_summary jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR length(coalesce(p_query,'')) > 200 OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 0 AND 11) THEN
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

REVOKE ALL ON FUNCTION public.faculty_directory(text,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faculty_directory(text,integer,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
