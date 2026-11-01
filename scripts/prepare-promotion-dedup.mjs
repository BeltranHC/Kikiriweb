import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, stringifyCSV } from '../lib/csv.mjs';
import { parseFacultyCSV, decodeFacultyCSV } from '../lib/faculty.mjs';
import { promotionDuplicateCases, buildDuplicateReviewSQL, buildDuplicateCleanupSQL } from '../lib/promotion-dedup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const initialFile=process.argv[2]||'datos_import.csv';const facultyFile=process.argv[3]||'Lista_FInesi.csv';
const initial=parseCSV(decodeFacultyCSV(await readFile(resolve(initialFile)))).map(row=>({name:row.nombre}));
if(initial.length!==35||initial.some(s=>typeof s.name!=='string'||!s.name.trim())) throw new Error('El archivo inicial debe contener los nombres de los 35 registros originales');
const faculty=parseFacultyCSV(decodeFacultyCSV(await readFile(resolve(facultyFile))));
const cases=promotionDuplicateCases(initial,faculty);
const summary={initial:initial.length,faculty:faculty.length,fullNameMatches:cases.filter(c=>c.local_status==='coincidencia_completa').length,
  ambiguous:cases.filter(c=>c.local_status==='revisar').length,unmatched:cases.filter(c=>c.local_status==='sin_coincidencia').length,
  duplicateSemesters:Object.fromEntries([...new Set(cases.filter(c=>c.faculty_semester).map(c=>c.faculty_semester))].sort((a,b)=>a-b).map(s=>[s,cases.filter(c=>c.faculty_semester===s).length]))};
const output=resolve(root,'artifacts/faculty-roster');await mkdir(output,{recursive:true});
await writeFile(resolve(output,'reporte_duplicados_promocion.csv'),stringifyCSV([
  ['Nombre inicial (conservar)','Nombre en facultad (copia)','Código a conservar','Semestre de la copia','Resultado local'],
  ...cases.map(c=>[c.initial_name,c.faculty_name||'',c.faculty_code||'',c.faculty_semester??'',c.local_status]),
]),'utf8');
await writeFile(resolve(output,'revision_duplicados_promocion.sql'),buildDuplicateReviewSQL(cases),'utf8');
const template=await readFile(resolve(root,'supabase/operations/merge_promotion_duplicates.sql'),'utf8');
await writeFile(resolve(output,'unificar_duplicados_promocion.sql'),buildDuplicateCleanupSQL(cases,template),'utf8');
await writeFile(resolve(output,'resumen_duplicados.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify(summary));console.log('Reportes y SQL privados preparados. No se ha conectado a Supabase.');
