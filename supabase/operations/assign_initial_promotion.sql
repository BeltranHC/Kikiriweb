-- Clasifica únicamente el grupo inicial de 35 estudiantes sin semestre.
-- Requiere 20261031_promotion_category.sql. No modifica tickets ni historial.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.students IN SHARE ROW EXCLUSIVE MODE;
DO $initial_promotion$
DECLARE v_unknown integer; v_promotion integer; v_updated integer;
BEGIN
  SELECT count(*) FILTER (WHERE semester IS NULL),count(*) FILTER (WHERE semester=11)
    INTO v_unknown,v_promotion FROM public.students;
  IF v_promotion=35 THEN
    RAISE NOTICE 'Los 35 registros ya están clasificados como Promoción. No se modificaron otros estudiantes.';
  ELSIF v_unknown=35 AND v_promotion=0 THEN
    UPDATE public.students SET semester=11,roster_updated_at=clock_timestamp() WHERE semester IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 35 THEN RAISE EXCEPTION 'No coincidió el grupo inicial. Se cancela la actualización.'; END IF;
    RAISE NOTICE '35 estudiantes clasificados como Promoción. Tickets e historial conservados.';
  ELSE
    RAISE EXCEPTION 'Se esperaban 35 estudiantes sin semestre y ninguna Promoción; hay % sin semestre y % en Promoción. No se modificó ningún estudiante.',v_unknown,v_promotion;
  END IF;
END $initial_promotion$;
SELECT CASE WHEN semester=11 THEN 'Promoción' WHEN semester IS NULL THEN 'Sin semestre' ELSE semester::text END AS grupo,
  count(*) AS estudiantes FROM public.students GROUP BY semester ORDER BY semester NULLS LAST;
COMMIT;
