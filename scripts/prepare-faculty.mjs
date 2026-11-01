import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFacultyCSV, decodeFacultyCSV, SEMESTERS, PROMOTION_SEMESTER } from '../lib/faculty.mjs';
import { parseCSV, stringifyCSV } from '../lib/csv.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
if (!input) throw new Error('Uso: npm run prepare:faculty -- Lista_FInesi.csv');
const text = decodeFacultyCSV(await readFile(resolve(input)));
const students = parseFacultyCSV(text);
const source = new Map(parseCSV(text).map(row => [row.codigo.trim().toUpperCase(), row]));
const output = resolve(root, 'artifacts', 'faculty-roster');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'Lista_FInesi_ordenada.csv'), stringifyCSV([
  ['Código', 'Nombres', 'Apellidos', 'Escuela Profesional', 'Semestre'],
  ...students.map(student => { const row = source.get(student.code); return [student.code, row.nombre, row.apellidos || '', student.school || '', student.semester === PROMOTION_SEMESTER ? 'Promoción' : student.semester ? SEMESTERS[student.semester - 1] : '']; }),
]), 'utf8');
const migration = await readFile(resolve(root, 'supabase/migrations/20261031_faculty_distribution.sql'), 'utf8');
const promotionMigration = await readFile(resolve(root, 'supabase/migrations/20261031_promotion_category.sql'), 'utf8');
const promotionOperation = await readFile(resolve(root, 'supabase/operations/assign_initial_promotion.sql'), 'utf8');
await writeFile(resolve(output, 'asignar_promocion.sql'), promotionMigration.replace(/COMMIT;\s*$/, '') + promotionOperation.replace(/BEGIN;/, ''), 'utf8');
const distributionMode = await readFile(resolve(root, 'supabase/migrations/20261031_distribution_only_history.sql'), 'utf8');
await writeFile(resolve(output, 'activar_solo_reparto.sql'), distributionMode, 'utf8');
const literal = JSON.stringify(students).replace(/'/g, "''");
const seed = `
-- ARCHIVO PRIVADO: contiene el padrón proporcionado por la facultad.
-- Ejecutar en SQL Editor como administrador. No compartir ni subir a Git.
-- Solo agrega códigos nuevos; no reemplaza correcciones manuales ni crea tickets.
BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $faculty_seed$
DECLARE v_rows jsonb := '${literal}'::jsonb; v_row jsonb; v_created integer := 0; v_id uuid;
BEGIN
  IF NOT has_table_privilege(current_user, 'public.students', 'INSERT') THEN
    RAISE EXCEPTION 'Ejecuta este archivo con la cuenta administradora del SQL Editor' USING ERRCODE='42501';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) ORDER BY lower(btrim(value->>'code')) LOOP
    PERFORM public.validate_faculty_student(v_row->>'name',v_row->>'code',(v_row->>'semester')::integer,v_row->>'school');
    INSERT INTO public.students(name,code,semester,school)
      VALUES(v_row->>'name',v_row->>'code',(v_row->>'semester')::integer,v_row->>'school')
      ON CONFLICT ((lower(btrim(code)))) WHERE code IS NOT NULL AND btrim(code) <> '' DO NOTHING RETURNING id INTO v_id;
    IF FOUND THEN v_created := v_created+1; END IF;
  END LOOP;
  RAISE NOTICE 'Padrón cargado: % estudiantes nuevos, % códigos ya registrados.',v_created,jsonb_array_length(v_rows)-v_created;
END $faculty_seed$;
SELECT coalesce(semester::text,'Sin semestre') AS semestre,count(*) AS estudiantes FROM public.students GROUP BY semester ORDER BY semester NULLS LAST;
COMMIT;
`;
await writeFile(resolve(output, 'instalar_reparto_y_padron.sql'), migration + promotionMigration + seed + distributionMode, 'utf8');
const summary = { total: students.length, semesters: Object.fromEntries(SEMESTERS.map((label, i) => [label, students.filter(student => student.semester === i + 1).length])), schools: [...new Set(students.map(student => student.school))] };
await writeFile(resolve(output, 'resumen.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary));
console.log('Archivos privados preparados en artifacts/faculty-roster. No se ha conectado a Supabase.');
