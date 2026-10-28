-- KikiriWeb: migración transaccional con verificación de los datos existentes.
-- Guarda un respaldo externo antes de ejecutarla completa en Supabase.
-- Las copias temporales de control NO sustituyen ese respaldo.
-- Todas las tablas creadas declaran RLS, incluidas las copias privadas de pg_temp.
-- Pega el archivo completo en el editor; no uses el agregado automático de RLS.
-- La definición de delete_student puede activar la advertencia del editor:
-- crear esa función no ejecuta su borrado.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  code text, dni text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_number integer NOT NULL UNIQUE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  is_picked_up boolean NOT NULL DEFAULT false, picked_up_at timestamptz, picked_up_by uuid,
  is_extra boolean NOT NULL DEFAULT false, is_paid boolean NOT NULL DEFAULT false,
  payment_method text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
-- Bloquear escrituras durante la comparación; los cambios de esquema también pueden bloquear lecturas.
-- Si hay una operación larga, el límite de espera cancela toda la migración.
LOCK TABLE public.students, public.tickets IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE pg_temp.kikiri_migration_students_before ON COMMIT DROP AS
  SELECT id, to_jsonb(s) AS original FROM public.students s;
ALTER TABLE pg_temp.kikiri_migration_students_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_migration_students_before FROM PUBLIC, anon, authenticated, service_role;
CREATE TEMP TABLE pg_temp.kikiri_migration_tickets_before ON COMMIT DROP AS
  SELECT id, to_jsonb(t) AS original FROM public.tickets t;
ALTER TABLE pg_temp.kikiri_migration_tickets_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_migration_tickets_before FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS unit_price numeric(10,2) NOT NULL DEFAULT 15;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS movement_id uuid;

CREATE TABLE IF NOT EXISTS public.ticket_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('pickup', 'undo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid, actor_email text,
  payment_method text,
  ticket_ids uuid[] NOT NULL,
  ticket_snapshots jsonb NOT NULL CHECK (jsonb_typeof(ticket_snapshots) = 'array')
);
ALTER TABLE public.ticket_movements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_movement_id_fkey' AND conrelid = 'public.tickets'::regclass) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES public.ticket_movements(id);
  END IF;
END $$;
LOCK TABLE public.ticket_movements IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE pg_temp.kikiri_migration_movements_before ON COMMIT DROP AS
  SELECT id, to_jsonb(m) AS original FROM public.ticket_movements m;
ALTER TABLE pg_temp.kikiri_migration_movements_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pg_temp.kikiri_migration_movements_before FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS tickets_student_id_idx ON public.tickets(student_id);
CREATE INDEX IF NOT EXISTS tickets_pickup_idx ON public.tickets(picked_up_at, id) WHERE is_picked_up;
CREATE INDEX IF NOT EXISTS tickets_movement_id_idx ON public.tickets(movement_id);
CREATE INDEX IF NOT EXISTS ticket_movements_created_idx ON public.ticket_movements(created_at DESC, id);
CREATE INDEX IF NOT EXISTS ticket_movements_ticket_ids_idx ON public.ticket_movements USING gin(ticket_ids);

CREATE OR REPLACE FUNCTION public.snapshot_tickets(p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'ticket_number', t.ticket_number, 'student_id', t.student_id,
    'student_name', s.name, 'code', s.code, 'is_extra', t.is_extra,
    'unit_price', t.unit_price, 'payment_method', t.payment_method, 'movement_id', t.movement_id
  ) ORDER BY t.ticket_number), '[]'::jsonb)
  FROM public.tickets t LEFT JOIN public.students s ON s.id = t.student_id WHERE t.id = ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.snapshot_tickets(uuid[]) FROM PUBLIC, anon, authenticated;

-- Recuperar entregas antiguas. No es posible reconstruir anulaciones ya borradas.
DO $$ DECLARE v_group record; v_id uuid; BEGIN
  FOR v_group IN
    SELECT array_agg(id ORDER BY ticket_number) AS ids,
      coalesce(picked_up_at, created_at) AS event_time, picked_up_by, payment_method
    FROM public.tickets WHERE is_picked_up AND movement_id IS NULL
    GROUP BY coalesce(picked_up_at, created_at), picked_up_by, payment_method, student_id
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.ticket_movements(id, kind, created_at, actor_id, actor_email, payment_method, ticket_ids, ticket_snapshots)
    VALUES (v_id, 'pickup', v_group.event_time, v_group.picked_up_by,
      nullif(split_part(v_group.payment_method, '|', 2), ''),
      CASE WHEN split_part(v_group.payment_method, '|', 1) = 'en_momento' THEN 'en_momento_efectivo'
        ELSE split_part(v_group.payment_method, '|', 1) END,
      v_group.ids, public.snapshot_tickets(v_group.ids));
    -- Vincular el historial sin cambiar fechas, pagos, cajeros ni asignaciones.
    UPDATE public.tickets SET movement_id = v_id WHERE id = ANY(v_group.ids);
  END LOOP;
END $$;

REVOKE ALL ON public.students, public.tickets, public.ticket_movements FROM anon, authenticated;
GRANT SELECT ON public.students, public.tickets, public.ticket_movements TO authenticated;
GRANT ALL ON public.students, public.tickets, public.ticket_movements TO service_role;
-- Crear nuestras políticas cuando falten y ajustar las existentes sin eliminarlas.
-- Una política ajena con el mismo nombre debe revisarse antes de continuar.
DO $policies$
DECLARE v_table text; v_name text; v_existing pg_catalog.pg_policy%ROWTYPE;
BEGIN
  FOR v_table, v_name IN VALUES
    ('students', 'authenticated_read_students'),
    ('tickets', 'authenticated_read_tickets'),
    ('ticket_movements', 'authenticated_read_movements')
  LOOP
    SELECT p.* INTO v_existing FROM pg_catalog.pg_policy p
      WHERE p.polrelid = format('public.%I', v_table)::regclass AND p.polname = v_name;
    IF FOUND THEN
      IF v_existing.polcmd <> 'r' OR NOT v_existing.polpermissive THEN
        RAISE EXCEPTION 'La política % tiene una definición incompatible. No se modificó; requiere revisión.', v_name;
      END IF;
      EXECUTE format(
        'ALTER POLICY %I ON public.%I TO authenticated USING (auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>''is_anonymous'', ''false'') <> ''true'')',
        v_name, v_table
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>''is_anonymous'', ''false'') <> ''true'')',
        v_name, v_table
      );
    END IF;
  END LOOP;
END $policies$;

CREATE OR REPLACE FUNCTION public.require_ticket_operator() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION 'Debes iniciar sesión con una cuenta autorizada' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_ticket_operator() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_student_with_tickets(
  p_name text, p_code text DEFAULT NULL, p_dni text DEFAULT NULL, p_ticket_numbers integer[] DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_student public.students;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR length(coalesce(p_code, '')) > 50
    OR (p_dni IS NOT NULL AND p_dni <> '' AND p_dni !~ '^[0-9]{8}$')
    OR p_ticket_numbers IS NULL OR cardinality(p_ticket_numbers) > 2000
    OR EXISTS (SELECT 1 FROM unnest(p_ticket_numbers) AS n WHERE n IS NULL OR n < 1)
    OR (SELECT count(DISTINCT n) FROM unnest(p_ticket_numbers) AS n) <> cardinality(p_ticket_numbers) THEN
    RAISE EXCEPTION 'Datos de estudiante o tickets inválidos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.students(name, code, dni) VALUES (btrim(p_name), nullif(btrim(p_code), ''), nullif(p_dni, '')) RETURNING * INTO v_student;
  INSERT INTO public.tickets(ticket_number, student_id) SELECT n, v_student.id FROM unnest(p_ticket_numbers) AS n;
  RETURN to_jsonb(v_student);
END $$;

CREATE OR REPLACE FUNCTION public.import_students(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row jsonb; v_numbers integer[]; v_students integer := 0; v_tickets integer := 0;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Archivo inválido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Cantidad de estudiantes inválida' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row->'tickets') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Lista de tickets inválida' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(value::integer), '{}'::integer[]) INTO v_numbers FROM jsonb_array_elements_text(v_row->'tickets');
    v_tickets := v_tickets + cardinality(v_numbers);
    IF v_tickets > 10000 THEN RAISE EXCEPTION 'Demasiados tickets' USING ERRCODE = '22023'; END IF;
    PERFORM public.create_student_with_tickets(v_row->>'name', v_row->>'code', v_row->>'dni', v_numbers);
    v_students := v_students + 1;
  END LOOP;
  RETURN jsonb_build_object('studentsCreated', v_students, 'ticketsCreated', v_tickets);
END $$;

CREATE OR REPLACE FUNCTION public.create_ticket(p_ticket_number integer, p_student_id uuid, p_is_extra boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket public.tickets;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_number IS NULL OR p_ticket_number < 1 OR p_is_extra IS NULL
    OR (p_is_extra AND p_student_id IS NOT NULL) OR (NOT p_is_extra AND p_student_id IS NULL) THEN
    RAISE EXCEPTION 'Datos de ticket inválidos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tickets(ticket_number, student_id, is_extra)
  VALUES (p_ticket_number, p_student_id, p_is_extra) RETURNING * INTO v_ticket;
  RETURN to_jsonb(v_ticket);
END $$;

CREATE OR REPLACE FUNCTION public.update_ticket_pickup(
  p_ticket_ids uuid[], p_is_picked_up boolean, p_payment_method text DEFAULT NULL, p_expected_movement_id uuid DEFAULT NULL
) RETURNS SETOF public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_id uuid := gen_random_uuid(); v_time timestamptz := clock_timestamp(); v_email text;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_ticket_ids IS NULL OR cardinality(p_ticket_ids) NOT BETWEEN 1 AND 2000 OR p_is_picked_up IS NULL
    OR (SELECT count(DISTINCT id) FROM unnest(p_ticket_ids) AS id) <> cardinality(p_ticket_ids)
    OR (p_is_picked_up AND (p_payment_method IS NULL OR p_payment_method NOT IN ('en_momento_efectivo', 'en_momento_yape', 'previo'))) THEN
    RAISE EXCEPTION 'Entrega inválida' USING ERRCODE = '22023';
  END IF;
  -- Orden fijo para evitar deadlocks en lotes que comparten tickets.
  PERFORM id FROM public.tickets WHERE id = ANY(p_ticket_ids) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_ticket_ids) THEN RAISE EXCEPTION 'No se encontraron todos los tickets' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE id = ANY(p_ticket_ids) AND is_picked_up IS DISTINCT FROM NOT p_is_picked_up) THEN
    RAISE EXCEPTION 'Los tickets cambiaron de estado. Actualiza la lista antes de continuar.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_is_picked_up AND (p_expected_movement_id IS NULL OR EXISTS (
    SELECT 1 FROM public.tickets WHERE id = ANY(p_ticket_ids) AND movement_id IS DISTINCT FROM p_expected_movement_id
  )) THEN
    RAISE EXCEPTION 'La entrega cambió. Actualiza el historial antes de anularla.' USING ERRCODE = 'P0001';
  END IF;
  v_email := coalesce(auth.jwt()->>'email', 'Desconocido');
  INSERT INTO public.ticket_movements(id, kind, created_at, actor_id, actor_email, payment_method, ticket_ids, ticket_snapshots)
  VALUES (v_id, CASE WHEN p_is_picked_up THEN 'pickup' ELSE 'undo' END, v_time, auth.uid(), v_email,
    CASE WHEN p_is_picked_up THEN p_payment_method ELSE NULL END, p_ticket_ids, public.snapshot_tickets(p_ticket_ids));
  RETURN QUERY UPDATE public.tickets SET
    is_picked_up = p_is_picked_up, is_paid = p_is_picked_up,
    picked_up_at = CASE WHEN p_is_picked_up THEN v_time ELSE NULL END,
    picked_up_by = CASE WHEN p_is_picked_up THEN auth.uid() ELSE NULL END,
    payment_method = CASE WHEN p_is_picked_up THEN p_payment_method || '|' || v_email ELSE NULL END,
    movement_id = CASE WHEN p_is_picked_up THEN v_id ELSE NULL END
  WHERE id = ANY(p_ticket_ids) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.preserve_ticket_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ticket_movements WHERE ticket_ids @> ARRAY[OLD.id]) THEN
    RAISE EXCEPTION 'No se puede eliminar un ticket o estudiante con movimientos registrados' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.preserve_ticket_history() FROM PUBLIC, anon, authenticated;
-- Conservar el disparador si ya tiene la definición esperada.
DO $history_trigger$
DECLARE v_existing pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  SELECT t.* INTO v_existing FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.tickets'::regclass AND t.tgname = 'preserve_ticket_history';
  IF NOT FOUND THEN
    CREATE TRIGGER preserve_ticket_history BEFORE DELETE ON public.tickets
      FOR EACH ROW EXECUTE FUNCTION public.preserve_ticket_history();
  ELSE
    -- tgtype 11 corresponde a BEFORE DELETE FOR EACH ROW.
    IF v_existing.tgisinternal OR v_existing.tgtype <> 11
      OR v_existing.tgfoid <> 'public.preserve_ticket_history()'::regprocedure
      OR v_existing.tgqual IS NOT NULL OR v_existing.tgnargs <> 0
      OR v_existing.tgconstraint <> 0 THEN
      RAISE EXCEPTION 'El disparador preserve_ticket_history tiene una definición incompatible. No se modificó; requiere revisión.';
    END IF;
    ALTER TABLE public.tickets ENABLE TRIGGER preserve_ticket_history;
  END IF;
END $history_trigger$;

CREATE OR REPLACE FUNCTION public.delete_student(p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.require_ticket_operator();
  DELETE FROM public.students WHERE id = p_student_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;

CREATE OR REPLACE FUNCTION public.ticket_stats(p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM public.require_ticket_operator();
  IF p_date IS NULL THEN RAISE EXCEPTION 'Fecha inválida' USING ERRCODE = '22023'; END IF;
  v_start := p_date::timestamp AT TIME ZONE 'America/Lima';
  v_end := (p_date + 1)::timestamp AT TIME ZONE 'America/Lima';
  SELECT jsonb_build_object(
    'totalTickets', count(*), 'pickedUp', count(*) FILTER (WHERE is_picked_up),
    'pending', count(*) FILTER (WHERE NOT is_picked_up),
    'extraTickets', count(*) FILTER (WHERE is_extra AND NOT is_picked_up),
    'totalStudents', (SELECT count(*) FROM public.students), 'date', p_date,
    'collectedCash', coalesce(sum(unit_price) FILTER (WHERE is_picked_up AND picked_up_at >= v_start AND picked_up_at < v_end AND split_part(payment_method, '|', 1) IN ('en_momento', 'en_momento_efectivo')), 0),
    'collectedYape', coalesce(sum(unit_price) FILTER (WHERE is_picked_up AND picked_up_at >= v_start AND picked_up_at < v_end AND split_part(payment_method, '|', 1) = 'en_momento_yape'), 0)
  ) INTO v_result FROM public.tickets;
  RETURN v_result || jsonb_build_object('collectedNow', (v_result->>'collectedCash')::numeric + (v_result->>'collectedYape')::numeric);
END $$;

-- Solo las funciones transaccionales pueden escribir desde una sesión de usuario.
REVOKE ALL ON FUNCTION public.create_student_with_tickets(text,text,text,integer[]), public.import_students(jsonb), public.create_ticket(integer,uuid,boolean), public.update_ticket_pickup(uuid[],boolean,text,uuid), public.delete_student(uuid), public.ticket_stats(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_student_with_tickets(text,text,text,integer[]), public.import_students(jsonb), public.create_ticket(integer,uuid,boolean), public.update_ticket_pickup(uuid[],boolean,text,uuid), public.delete_student(uuid), public.ticket_stats(date) TO authenticated;
-- Comparar todos los campos originales, no solamente la cantidad de filas.
-- En tickets solo se permite agregar la referencia a una entrega antigua.
DO $verify_preservation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.kikiri_migration_students_before b
    FULL JOIN public.students s ON s.id = b.id
    WHERE b.id IS NULL OR s.id IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_each(b.original) f
      WHERE to_jsonb(s)->f.key IS DISTINCT FROM f.value
    )
  ) THEN
    RAISE EXCEPTION 'Verificación fallida: cambiaron registros de estudiantes. Se cancela toda la migración.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.kikiri_migration_tickets_before b
    FULL JOIN public.tickets t ON t.id = b.id
    WHERE b.id IS NULL OR t.id IS NULL
      OR EXISTS (
        SELECT 1 FROM jsonb_each(b.original - 'movement_id') f
        WHERE to_jsonb(t)->f.key IS DISTINCT FROM f.value
      )
      OR (b.original->>'movement_id' IS NOT NULL
        AND t.movement_id::text IS DISTINCT FROM b.original->>'movement_id')
      OR (NOT t.is_picked_up AND b.original->>'movement_id' IS NULL AND t.movement_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Verificación fallida: cambiaron datos originales de tickets. Se cancela toda la migración.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.kikiri_migration_movements_before b
    LEFT JOIN public.ticket_movements m ON m.id = b.id
    WHERE m.id IS NULL OR to_jsonb(m) IS DISTINCT FROM b.original
  ) THEN
    RAISE EXCEPTION 'Verificación fallida: cambió el historial existente. Se cancela toda la migración.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE is_picked_up AND movement_id IS NULL) THEN
    RAISE EXCEPTION 'Verificación fallida: faltan entregas por registrar en el historial.';
  END IF;
  RAISE NOTICE 'Datos originales verificados: % estudiantes, % tickets. Solo se agregaron columnas y referencias al historial.',
    (SELECT count(*) FROM pg_temp.kikiri_migration_students_before),
    (SELECT count(*) FROM pg_temp.kikiri_migration_tickets_before);
END $verify_preservation$;

SELECT
  'Verificación de datos completada' AS resultado,
  (SELECT count(*) FROM pg_temp.kikiri_migration_students_before) AS estudiantes_antes,
  (SELECT count(*) FROM public.students) AS estudiantes_despues,
  (SELECT count(*) FROM pg_temp.kikiri_migration_tickets_before) AS tickets_antes,
  (SELECT count(*) FROM public.tickets) AS tickets_despues,
  (SELECT count(*) FROM public.ticket_movements) -
    (SELECT count(*) FROM pg_temp.kikiri_migration_movements_before) AS movimientos_agregados;

NOTIFY pgrst, 'reload schema';
COMMIT;
