// Administrative comparison only. Never use partial names to remove students.
export function identityTokens(value) {
  return String(value ?? '').toLowerCase().replace(/ñ/g, '\u0000').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\u0000/g, 'ñ')
    .replace(/[^a-zñ]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort();
}
export function promotionDuplicateCases(initial, faculty) {
  const oldGroups = new Map(); const facultyGroups = new Map();
  const key = name => JSON.stringify(identityTokens(name));
  for (const student of initial) { const id=key(student.name); oldGroups.set(id,[...(oldGroups.get(id)||[]),student]); }
  for (const student of faculty) { const id=key(student.name); facultyGroups.set(id,[...(facultyGroups.get(id)||[]),student]); }
  return initial.map(student => {
    const id=key(student.name); const candidates=facultyGroups.get(id)||[];
    const valid=identityTokens(student.name).length>=3 && !/[0-9]/.test(student.name);
    const unique=valid && oldGroups.get(id).length===1 && candidates.length===1;
    return { initial_name:student.name,faculty_name:unique?candidates[0].name:null,faculty_code:unique?candidates[0].code:null,
      faculty_semester:unique?candidates[0].semester:null,
      local_status:unique?'coincidencia_completa':candidates.length?'revisar':'sin_coincidencia', candidate_count:candidates.length };
  });
}
const literal = value => {
  const json=JSON.stringify(value); let n=0;
  while(json.includes(`$promotion_input_${n}$`)) n++;
  const tag=`$promotion_input_${n}$`;return `${tag}${json}${tag}::jsonb`;
};
const nameTokens = expression => `ARRAY(SELECT token COLLATE "C" FROM unnest(regexp_split_to_array(btrim(regexp_replace(translate(lower(coalesce(${expression},'')), 'áéíóúü', 'aeiouu'), '[^a-zñ]+', ' ', 'g')), ' +')) token WHERE token<>'' ORDER BY token COLLATE "C")`;
export function duplicateCandidatesSQL(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length>1000) throw new Error('Lista de comparación inválida');
  return `WITH source AS (
  SELECT s.*,${nameTokens('s.initial_name')} AS name_tokens FROM jsonb_to_recordset(${literal(cases)})
    AS s(initial_name text,faculty_name text,faculty_code text,faculty_semester integer,local_status text,candidate_count integer)
), normalized AS (
  SELECT s.*,to_jsonb(s) AS original,${nameTokens('s.name')} AS name_tokens FROM public.students s
), sizes AS (
  SELECT name_tokens,count(*) FILTER(WHERE semester=11) AS promotion_count,
    count(*) FILTER(WHERE semester IS DISTINCT FROM 11) AS duplicate_count FROM normalized GROUP BY name_tokens
), candidates AS (
  SELECT source.initial_name,source.faculty_name,source.faculty_code,
    p.id AS promotion_id,p.name AS promotion_name,p.code AS promotion_code,
    d.id AS duplicate_id,d.name AS duplicate_name,d.code AS duplicate_code,d.semester AS duplicate_semester,
    p.original AS promotion_before,d.original AS duplicate_before,
    (SELECT count(*) FROM public.tickets t WHERE t.student_id=d.id) AS tickets_to_move,
    (SELECT count(*) FROM public.ticket_assignments a WHERE a.student_id=d.id) AS assignments_to_move,
    CASE
      WHEN source.local_status<>'coincidencia_completa' THEN source.local_status
      WHEN p.id IS NULL THEN 'revisar'
      WHEN d.id IS NULL THEN 'sin_copia'
      WHEN cardinality(source.name_tokens)<3 OR source.initial_name ~ '[0-9]' OR p.name ~ '[0-9]' OR d.name ~ '[0-9]' THEN 'revisar'
      WHEN sizes.promotion_count<>1 OR sizes.duplicate_count<>1 THEN 'revisar'
      WHEN lower(btrim(coalesce(d.code,'')))<>lower(btrim(source.faculty_code)) THEN 'revisar'
      WHEN nullif(btrim(p.code),'') IS NOT NULL AND lower(btrim(p.code))<>lower(btrim(d.code)) THEN 'revisar'
      WHEN nullif(btrim(p.dni),'') IS NOT NULL AND nullif(btrim(d.dni),'') IS NOT NULL AND btrim(p.dni)<>btrim(d.dni) THEN 'revisar'
      ELSE 'unificar' END AS action,
    CASE
      WHEN source.local_status='sin_coincidencia' THEN 'No se encontró el nombre completo en el CSV de la facultad'
      WHEN source.local_status<>'coincidencia_completa' THEN 'La coincidencia local no es única o el nombre está incompleto'
      WHEN p.id IS NULL THEN 'El perfil de Promoción no coincide con el archivo inicial'
      WHEN d.id IS NULL THEN 'La copia ya no existe o su nombre cambió; no se elimina nada'
      WHEN cardinality(source.name_tokens)<3 OR source.initial_name ~ '[0-9]' OR p.name ~ '[0-9]' OR d.name ~ '[0-9]' THEN 'Nombre incompleto o con números: revisar'
      WHEN sizes.promotion_count<>1 OR sizes.duplicate_count<>1 THEN 'Hay varias personas con el mismo nombre completo: revisar'
      WHEN lower(btrim(coalesce(d.code,'')))<>lower(btrim(source.faculty_code)) THEN 'El código de la copia no coincide con el CSV'
      WHEN nullif(btrim(p.code),'') IS NOT NULL AND lower(btrim(p.code))<>lower(btrim(d.code)) THEN 'Los perfiles tienen códigos diferentes'
      WHEN nullif(btrim(p.dni),'') IS NOT NULL AND nullif(btrim(d.dni),'') IS NOT NULL AND btrim(p.dni)<>btrim(d.dni) THEN 'Los perfiles tienen DNI diferentes'
      ELSE 'Mismo nombre y apellidos completos, orden flexible, coincidencia única y código del CSV confirmado' END AS reason
  FROM source
  LEFT JOIN normalized p ON p.semester=11 AND p.name_tokens=source.name_tokens
  LEFT JOIN sizes ON sizes.name_tokens=source.name_tokens
  LEFT JOIN normalized d ON p.id IS NOT NULL AND d.semester IS DISTINCT FROM 11 AND d.name_tokens=source.name_tokens
)
`;
}
export function buildDuplicateReviewSQL(cases) {
  return '-- SOLO CONSULTA: contrasta los archivos locales con los registros actuales de Supabase.\n'+duplicateCandidatesSQL(cases)+
    'SELECT initial_name AS nombre_inicial,promotion_name AS conservar_promocion,duplicate_name AS copia,duplicate_code AS codigo,duplicate_semester AS semestre_copia,tickets_to_move,assignments_to_move,action AS accion,reason AS motivo,promotion_id,duplicate_id FROM candidates ORDER BY action,initial_name;\n';
}
export function buildDuplicateCleanupSQL(cases, template) {
  return template.replaceAll('-- CANDIDATES_CTE',duplicateCandidatesSQL(cases));
}
