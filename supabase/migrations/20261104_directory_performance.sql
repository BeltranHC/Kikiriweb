-- Ejecutar despues de 20261103_recipient_ticket_changes.sql.
-- Solo agrega una consulta de lectura: conserva participantes, tickets e historial.
BEGIN;
SET LOCAL lock_timeout = '10s';

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
    WHERE student_id IS NOT NULL GROUP BY student_id
  ), roster AS MATERIALIZED (
    SELECT s.*, coalesce(c.ticket_count,0) AS ticket_count,
      public.faculty_search_key(s.name) AS search_name,
      public.faculty_search_key(s.code) AS search_code
    FROM public.students s LEFT JOIN ticket_counts c ON c.student_id = s.id
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
        'tickets', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'ticket_number', t.ticket_number, 'is_picked_up', t.is_picked_up,
          'assignment_id', t.assignment_id, 'assignment_updated_at', t.assignment_updated_at,
          'can_edit', CASE WHEN t.is_available OR t.is_extra OR t.is_paid OR t.is_picked_up OR t.movement_id IS NOT NULL THEN false
            ELSE NOT EXISTS (SELECT 1 FROM public.ticket_movements m WHERE m.ticket_ids @> ARRAY[t.id]) END
        ) ORDER BY t.ticket_number) FROM public.tickets t WHERE t.student_id = p.id), '[]'::jsonb)
      ) ORDER BY CASE p.recipient_type WHEN 'student' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,
        p.semester NULLS LAST, p.search_name, p.id) FROM page_rows p), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching), 'page', p_page, 'pageSize', p_page_size,
    'hasMore', p_page::bigint * p_page_size < (SELECT count(*) FROM matching),
    'semesters', coalesce((SELECT jsonb_agg(jsonb_build_object('semester',semester,'count',n) ORDER BY semester NULLS LAST)
      FROM (SELECT semester,count(*) n FROM roster WHERE recipient_type = 'student' GROUP BY semester) groups), '[]'::jsonb),
    'categories', coalesce((SELECT jsonb_agg(jsonb_build_object('type',recipient_type,'count',n) ORDER BY recipient_type)
      FROM (SELECT recipient_type,count(*) n FROM roster GROUP BY recipient_type) groups), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object('totalStudents',count(*),
      'withTickets',count(*) FILTER (WHERE ticket_count > 0),
      'withoutTickets',count(*) FILTER (WHERE ticket_count = 0),
      'totalAssignedTickets',coalesce(sum(ticket_count),0)) FROM roster)
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.faculty_directory_v2(text,integer,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faculty_directory_v2(text,integer,text,text,integer,integer) TO authenticated;
SELECT 'Consulta optimizada instalada' AS resultado;
NOTIFY pgrst, 'reload schema';
COMMIT;
