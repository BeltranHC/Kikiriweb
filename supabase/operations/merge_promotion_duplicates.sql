-- PLANTILLA: generar con npm run prepare:dedup para incorporar los archivos privados.
-- Conserva el ID y la categoría de Promoción; elimina solo la copia confirmada.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $permissions$ BEGIN
  IF NOT has_table_privilege(current_user,'public.students','DELETE') OR NOT has_table_privilege(current_user,'public.students','UPDATE') THEN
    RAISE EXCEPTION 'Ejecuta esta operación como administrador en SQL Editor' USING ERRCODE='42501';
  END IF;
END $permissions$;
CREATE TABLE IF NOT EXISTS public.student_deduplication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  kept_student_id uuid NOT NULL REFERENCES public.students(id), removed_student_id uuid NOT NULL UNIQUE,
  kept_before jsonb NOT NULL, removed_before jsonb NOT NULL,
  tickets_before jsonb NOT NULL, assignments_before jsonb NOT NULL,
  source_code text, reason text NOT NULL, operated_by text NOT NULL DEFAULT current_user
);
ALTER TABLE public.student_deduplication_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_deduplication_log FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.student_deduplication_log TO service_role;
LOCK TABLE public.students,public.tickets,public.ticket_assignments,public.ticket_movements,public.student_deduplication_log IN EXCLUSIVE MODE;
DO $merge$
DECLARE v_plan jsonb; v_pair jsonb; v_map jsonb; v_promotions integer; v_removed integer:=0; v_tickets_moved integer:=0; v_assignments_moved integer:=0;
  v_students_before jsonb; v_tickets_before jsonb; v_assignments_before jsonb; v_movements_before jsonb;
  v_after jsonb; v_before jsonb; v_expected jsonb; v_actual jsonb; v_count integer; v_keep uuid; v_delete uuid;
BEGIN
  -- An unknown incoming foreign key could cascade into data this operation does not handle.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='public.students'::regclass AND NOT (
      (c.conrelid='public.tickets'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='student_id')]) OR
      (c.conrelid='public.ticket_assignments'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='student_id')]) OR
      (c.conrelid='public.student_deduplication_log'::regclass AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='kept_student_id')])
    )
  ) THEN RAISE EXCEPTION 'Existen otras tablas relacionadas con estudiantes. Revisa sus relaciones antes de unificar; no se modificó ningún dato.'; END IF;
  SELECT count(*) INTO v_promotions FROM public.students WHERE semester=11;
  IF v_promotions<>35 THEN RAISE EXCEPTION 'Se esperaban los 35 perfiles de Promoción; se encontraron %. No se modificó ningún dato.',v_promotions; END IF;
  -- CANDIDATES_CTE
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY promotion_id::text),'[]'::jsonb) INTO v_plan FROM candidates c WHERE action='unificar';
  IF (SELECT count(DISTINCT x->>'promotion_id') FROM jsonb_array_elements(v_plan) x)<>jsonb_array_length(v_plan)
    OR (SELECT count(DISTINCT x->>'duplicate_id') FROM jsonb_array_elements(v_plan) x)<>jsonb_array_length(v_plan) THEN
    RAISE EXCEPTION 'El plan contiene coincidencias ambiguas. Se cancela toda la unificación.';
  END IF;
  SELECT coalesce(jsonb_object_agg(x->>'duplicate_id',x->>'promotion_id'),'{}'::jsonb) INTO v_map FROM jsonb_array_elements(v_plan) x;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id::text),'[]'::jsonb) INTO v_students_before FROM public.students s;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id::text),'[]'::jsonb) INTO v_tickets_before FROM public.tickets t;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id::text),'[]'::jsonb) INTO v_assignments_before FROM public.ticket_assignments a;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id::text),'[]'::jsonb) INTO v_movements_before FROM public.ticket_movements m;
  FOR v_pair IN SELECT value FROM jsonb_array_elements(v_plan) LOOP
    v_keep:=(v_pair->>'promotion_id')::uuid;v_delete:=(v_pair->>'duplicate_id')::uuid;
    INSERT INTO public.student_deduplication_log(kept_student_id,removed_student_id,kept_before,removed_before,tickets_before,assignments_before,source_code,reason)
      VALUES(v_keep,v_delete,v_pair->'promotion_before',v_pair->'duplicate_before',
        (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id::text),'[]'::jsonb) FROM public.tickets t WHERE student_id=v_delete),
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id::text),'[]'::jsonb) FROM public.ticket_assignments a WHERE student_id=v_delete),
        v_pair->>'faculty_code',v_pair->>'reason');
    UPDATE public.tickets SET student_id=v_keep WHERE student_id=v_delete;
    GET DIAGNOSTICS v_count=ROW_COUNT;v_tickets_moved:=v_tickets_moved+v_count;
    -- Keep all original assignment snapshot fields; only the current profile link changes.
    UPDATE public.ticket_assignments SET student_id=v_keep WHERE student_id=v_delete;
    GET DIAGNOSTICS v_count=ROW_COUNT;v_assignments_moved:=v_assignments_moved+v_count;
    DELETE FROM public.students WHERE id=v_delete AND semester IS DISTINCT FROM 11;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count<>1 THEN RAISE EXCEPTION 'La copia cambió durante la operación. Se cancela toda la unificación.'; END IF;
    v_removed:=v_removed+1;
    -- The duplicate code is free after DELETE; attach it to the retained profile.
    UPDATE public.students SET
      code=CASE WHEN nullif(btrim(code),'') IS NULL THEN v_pair->'duplicate_before'->>'code' ELSE code END,
      dni=CASE WHEN nullif(btrim(dni),'') IS NULL THEN v_pair->'duplicate_before'->>'dni' ELSE dni END,
      school=CASE WHEN nullif(btrim(school),'') IS NULL THEN v_pair->'duplicate_before'->>'school' ELSE school END,
      roster_updated_at=clock_timestamp() WHERE id=v_keep AND semester=11;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count<>1 THEN RAISE EXCEPTION 'El perfil de Promoción cambió. Se cancela toda la unificación.'; END IF;
  END LOOP;
  -- Verify every ticket and assignment, allowing only the planned profile-link changes.
  SELECT coalesce(jsonb_agg(x || jsonb_build_object('student_id',coalesce(v_map->(x->>'student_id'),x->'student_id')) ORDER BY x->>'id'),'[]'::jsonb)
    INTO v_expected FROM jsonb_array_elements(v_tickets_before) x;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id::text),'[]'::jsonb) INTO v_actual FROM public.tickets t;
  IF v_expected IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'Cambió un ticket fuera del vínculo previsto. Se cancela toda la unificación.'; END IF;
  SELECT coalesce(jsonb_agg(x || jsonb_build_object('student_id',coalesce(v_map->(x->>'student_id'),x->'student_id')) ORDER BY x->>'id'),'[]'::jsonb)
    INTO v_expected FROM jsonb_array_elements(v_assignments_before) x;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id::text),'[]'::jsonb) INTO v_actual FROM public.ticket_assignments a;
  IF v_expected IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'Cambió una constancia de reparto fuera del vínculo previsto. Se cancela toda la unificación.'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id::text),'[]'::jsonb) INTO v_actual FROM public.ticket_movements m;
  IF v_movements_before IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'Cambió el historial de pagos o recogidos. Se cancela toda la unificación.'; END IF;
  FOR v_before IN SELECT value FROM jsonb_array_elements(v_students_before) LOOP
    IF v_map ? (v_before->>'id') THEN
      IF EXISTS(SELECT 1 FROM public.students WHERE id=(v_before->>'id')::uuid) THEN RAISE EXCEPTION 'No se eliminó una copia prevista'; END IF;
      CONTINUE;
    END IF;
    SELECT to_jsonb(s) INTO v_after FROM public.students s WHERE id=(v_before->>'id')::uuid;
    SELECT value INTO v_pair FROM jsonb_array_elements(v_plan) WHERE value->>'promotion_id'=v_before->>'id';
    IF FOUND THEN
      v_expected:=v_before || jsonb_build_object(
        'code',CASE WHEN nullif(btrim(v_before->>'code'),'') IS NULL THEN v_pair->'duplicate_before'->'code' ELSE v_before->'code' END,
        'dni',CASE WHEN nullif(btrim(v_before->>'dni'),'') IS NULL THEN v_pair->'duplicate_before'->'dni' ELSE v_before->'dni' END,
        'school',CASE WHEN nullif(btrim(v_before->>'school'),'') IS NULL THEN v_pair->'duplicate_before'->'school' ELSE v_before->'school' END);
      IF (v_expected-'roster_updated_at') IS DISTINCT FROM (v_after-'roster_updated_at') THEN RAISE EXCEPTION 'Cambió un perfil de Promoción fuera de los campos previstos'; END IF;
    ELSIF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'Cambió un estudiante ajeno a la unificación'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.students)<>jsonb_array_length(v_students_before)-v_removed OR (SELECT count(*) FROM public.students WHERE semester=11)<>35 THEN
    RAISE EXCEPTION 'Los totales no coinciden con la unificación prevista. Se cancela toda la operación.';
  END IF;
  RAISE NOTICE 'Unificación verificada: % copias eliminadas, % tickets y % constancias vinculados a Promoción. Historial intacto. Respaldo en public.student_deduplication_log.',v_removed,v_tickets_moved,v_assignments_moved;
END $merge$;
-- CANDIDATES_CTE
SELECT initial_name AS nombre_inicial,promotion_name AS conservar_promocion,duplicate_name AS copia,action AS estado,reason AS motivo FROM candidates ORDER BY action,initial_name;
SELECT CASE WHEN semester=11 THEN 'Promoción' WHEN semester IS NULL THEN 'Sin semestre' ELSE semester::text END AS grupo,
  count(*) AS estudiantes FROM public.students GROUP BY semester ORDER BY semester NULLS LAST;
COMMIT;
