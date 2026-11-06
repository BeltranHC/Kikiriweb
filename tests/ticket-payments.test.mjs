import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentSelection, batchPaymentInput } from '../lib/ticket-payments.mjs';
test('Selection totals only changing tickets, uses original paid amounts for reversal and adds cents accurately',()=>{
 const tickets=[{id:'a',unit_price:12.34,is_paid:false},{id:'b',unit_price:17.25,is_paid:false},{id:'c',unit_price:99,paid_amount:15,is_paid:true}];
 const paying=paymentSelection(tickets,['a','b','c'],'cash');assert.equal(paying.total,29.59);assert.equal(paying.changing.length,2);assert.equal(paying.unchanged,1);
 const reversing=paymentSelection(tickets,['a','c'],'pending');assert.equal(reversing.total,15);assert.equal(reversing.unchanged,1);
});
test('Batch input normalizes identities without trusting prices, authors or extra ticket fields',()=>{
 const id='11111111-1111-4111-8111-111111111111';const input=batchPaymentInput({studentId:id,condition:'pending',expectedTotal:0,tickets:[{id,updated_at:'2026-11-06T10:00:00Z',amount:1,actorId:'forged'}]});
 assert.deepEqual(Object.keys(input.tickets[0]),['id','updated_at']);assert.throws(()=>batchPaymentInput({...input,tickets:[...input.tickets,{...input.tickets[0],id:id.toUpperCase()}]}));
});
