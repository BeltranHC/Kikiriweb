-- Modo temporal: solo reparto, con historial de asignaciones.
-- Añade consultas e índices; no elimina ni modifica tickets, pagos o movimientos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL search_path = '';
CREATE INDEX IF NOT EXISTS ticket_assignments_created_idx ON public.ticket_assignments(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS ticket_assignments_numbers_idx ON public.ticket_assignments USING gin(ticket_numbers);

CREATE OR REPLACE FUNCTION public.faculty_assignment_history(
  p_query text DEFAULT '',p_semester integer DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,
  p_page integer DEFAULT 1,p_page_size integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tokens text[];v_ticket integer;v_number bigint;v_total bigint;v_rows jsonb;v_summary jsonb;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR length(coalesce(p_query,''))>200 OR (p_semester IS NOT NULL AND p_semester NOT BETWEEN 0 AND 11)
    OR (p_from IS NOT NULL AND p_until IS NOT NULL AND p_from>=p_until) THEN
    RAISE EXCEPTION 'Filtros del historial inválidos' USING ERRCODE='22023';
  END IF;
  v_tokens:=regexp_split_to_array(public.faculty_search_key(btrim(coalesce(p_query,''))),'\s+');
  IF btrim(coalesce(p_query,'')) ~ '^#?[0-9]{1,10}$' THEN
    v_number:=ltrim(btrim(p_query),'#')::bigint;
    IF v_number BETWEEN 1 AND 2147483647 THEN v_ticket:=v_number::integer; END IF;
  END IF;
  WITH matching AS (
    SELECT a.*,s.name AS current_student_name,s.code AS current_student_code,s.semester AS current_semester,
      cardinality(a.ticket_numbers) AS ticket_count
    FROM public.ticket_assignments a LEFT JOIN public.students s ON s.id=a.student_id
    WHERE (p_semester IS NULL OR (p_semester=0 AND a.semester IS NULL) OR a.semester=p_semester)
      AND (p_from IS NULL OR a.created_at>=p_from) AND (p_until IS NULL OR a.created_at<p_until)
      AND ((v_ticket IS NOT NULL AND a.ticket_numbers @> ARRAY[v_ticket]) OR NOT EXISTS (
        SELECT 1 FROM unnest(v_tokens) token WHERE strpos(public.faculty_search_key(concat_ws(' ',a.student_name,a.student_code,
          a.actor_email,a.id::text,'ASG-'||left(a.id::text,8),s.name,s.code,array_to_string(a.ticket_numbers,' '))),token)=0
      ))
  ), page_rows AS (
    SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT p_page_size OFFSET (p_page-1)*p_page_size
  )
  SELECT (SELECT count(*) FROM matching),coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id DESC),'[]'::jsonb)
    INTO v_total,v_rows FROM page_rows p;
  SELECT jsonb_build_object('assignments',count(*),'tickets',coalesce(sum(cardinality(ticket_numbers)),0),'students',count(DISTINCT student_id))
    INTO v_summary FROM public.ticket_assignments;
  RETURN jsonb_build_object('assignments',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'hasMore',p_page::bigint*p_page_size<v_total,'summary',v_summary);
END $$;
REVOKE ALL ON FUNCTION public.faculty_assignment_history(text,integer,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.faculty_assignment_history(text,integer,timestamptz,timestamptz,integer,integer) TO authenticated;

-- Lock every legacy overload, including older signatures left by previous releases.
-- The faculty save/import/assign functions remain available to signed-in operators.
DO $lock_legacy$
DECLARE v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('update_ticket_pickup','create_student_with_tickets','import_students','create_ticket','delete_student','ticket_stats')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_function.oid::regprocedure);
  END LOOP;
END $lock_legacy$;
NOTIFY pgrst,'reload schema';
COMMIT;
