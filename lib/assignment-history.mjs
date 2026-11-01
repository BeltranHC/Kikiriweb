import { ValidationError } from './validation.mjs';
import { PROMOTION_SEMESTER } from './faculty.mjs';
import { dayBounds } from './domain.mjs';

export function assignmentHistoryFilters(params) {
  const query=(params.get('q')||'').trim();
  const page=Number(params.get('page')||1);const pageSize=Number(params.get('pageSize')||30);
  const semester=params.has('semester') && params.get('semester')!=='all'?Number(params.get('semester')):null;
  if(query.length>200||!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||
    (semester!==null&&(!Number.isInteger(semester)||semester<0||semester>PROMOTION_SEMESTER))) throw new ValidationError('Filtros del historial inválidos');
  let from=null;let until=null;
  try {
    if(params.get('from')) from=dayBounds(params.get('from')).start;
    if(params.get('to')) until=dayBounds(params.get('to')).end;
  } catch {throw new ValidationError('Indica fechas válidas para el historial');}
  if(from&&until&&from>=until) throw new ValidationError('La fecha inicial no puede ser posterior a la fecha final');
  return {query,page,pageSize,semester,from,until};
}
