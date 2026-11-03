import test from 'node:test';
import assert from 'node:assert/strict';
import {participantReport,loadParticipantExport} from '../lib/faculty-export.mjs';
import {parseCSV} from '../lib/csv.mjs';

test('CSV includes every participant, categories and zero-ticket rows, sorts ticket numbers and escapes spreadsheet content',()=>{
 const people=[{id:'teacher',name:'Docente sin tickets',recipient_type:'teacher',code:null},
  {id:'prom',name:'Promocion',code:'PROM',recipient_type:'student',semester:11},
  {id:'student',name:'Pérez, "José"',code:'00123',dni:'00123456',semester:2,school:'FINESI',roster_updated_at:'2026-11-03T05:00:00Z',roster_updated_by_email:'operator@example.test'},
  {id:'ext',name:'=HYPERLINK("https://example.test")',recipient_type:'external'}];
 const tickets=[{id:'t2',student_id:'student',ticket_number:1052},{id:'t1',student_id:'student',ticket_number:1050},
  {id:'released',student_id:null,ticket_number:2000,is_available:true},{id:'ext-ticket',student_id:'ext',ticket_number:3000}];
 const before=JSON.stringify({people,tickets});const csv=participantReport(people,tickets);const rows=parseCSV(csv);
 assert.equal(csv.charCodeAt(0),0xfeff);assert(csv.includes('\r\n'));assert.equal(rows.length,4);
 assert.equal(rows[0].nombre,'Pérez, "José"');assert.equal(rows[0].codigo,'00123');assert.equal(rows[0].dni,'00123456');assert.equal(rows[0].semestre,'II');
 assert.equal(rows[0].tickets_asignados,'1050; 1052');assert.equal(rows[0].cantidad_tickets,'2');assert.equal(rows[0].modificado_por,'operator@example.test');
 assert.equal(rows[1].semestre,'Promoción');assert.equal(rows[2].categoria,'Externo');assert(rows[2].nombre.startsWith("'="));
 assert.equal(rows[3].categoria,'Docente');assert.equal(rows[3].cantidad_tickets,'0');assert.equal(rows[3].tickets_asignados,'');assert(!csv.includes('2000'));
 assert.equal(JSON.stringify({people,tickets}),before);assert.deepEqual(parseCSV(participantReport([],[])),[]);
});
function sourceFixture({fail=false}={}) {
 const people=Array.from({length:1203},(_,i)=>({id:`p-${String(i).padStart(4,'0')}`,name:`Persona ${i}`,code:String(i).padStart(6,'0'),semester:1}));
 const tickets=Array.from({length:2505},(_,i)=>({id:`t-${String(i).padStart(4,'0')}`,student_id:people[0].id,ticket_number:i+1,is_available:false}));
 const calls=[];const failure={code:'XX_TEST',message:'Simulated page failure'};
 const client={from(table){const query={select(fields){assert(!fields.includes('tickets('));return this;},not(){return this;},eq(){return this;},order(field){assert.equal(field,'id');return this;},async range(start,end){calls.push({table,start,end});if(fail&&table==='tickets'&&start>0)return {data:null,error:failure};return {data:(table==='students'?people:tickets).slice(start,Math.min(end+1,start+(table==='students'?37:113))),error:null};}};return query;}};
 return {client,calls,failure};
}
test('Export exhausts server-capped pages beyond one thousand participants and tickets without truncating a large allocation',async()=>{
 const {client,calls}=sourceFixture();const rows=parseCSV(await loadParticipantExport(client));assert.equal(rows.length,1203);
 const assigned=rows.find(row=>row.codigo==='000000');assert.equal(assigned.cantidad_tickets,'2505');assert.equal(assigned.tickets_asignados.split('; ').length,2505);
 assert.equal(rows.filter(row=>row.cantidad_tickets==='0').length,1202);assert(calls.some(c=>c.table==='students'&&c.start>1000));assert(calls.some(c=>c.table==='tickets'&&c.start>2000));
});
test('A later page failure rejects the whole export instead of returning a partial CSV',async()=>{
 const {client,failure}=sourceFixture({fail:true});await assert.rejects(()=>loadParticipantExport(client),error=>error===failure);
});
