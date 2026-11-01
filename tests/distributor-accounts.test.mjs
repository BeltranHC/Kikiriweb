import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDistributorAccounts,prepareDistributorCredentials,validateDistributorCredentials,provisionDistributors} from '../lib/distributor-accounts.mjs';
const users=[{name:'Repartidor 1',email:'one@example.test'},{name:'Repartidor 2',email:'two@example.test'}];
const clone=value=>JSON.parse(JSON.stringify(value));
function clientFixture() {
  const accounts=[];const calls=[];
  const client={auth:{admin:{listUsers:async({page})=>({data:{users:page===1?accounts:[]},error:null}),createUser:async payload=>{
    calls.push(payload);const user={id:`account-${accounts.length+1}`,email:payload.email,app_metadata:payload.app_metadata};accounts.push(user);return {data:{user},error:null};
  }}}};return {client,accounts,calls};
}
test('Exactly two distinct accounts are required before generating independent strong passwords',()=>{
  assert.throws(()=>validateDistributorAccounts([users[0]]));assert.throws(()=>validateDistributorAccounts([users[0],users[0]]));
  assert.throws(()=>validateDistributorAccounts([users[0],{name:'Missing email'}]));
  const document=prepareDistributorCredentials(users);assert.equal(document.users.length,2);assert.notEqual(document.users[0].password,document.users[1].password);
  assert(document.users.every(user=>user.password.length===16&&/[A-Z]/.test(user.password)&&/[a-z]/.test(user.password)&&/[0-9]/.test(user.password)&&/[-!@#$%*+]/.test(user.password)));
});
test('Creates both distributors, records progress without secrets, and never recreates or rotates them on a rerun',async()=>{
  const {client,accounts,calls}=clientFixture();const document=prepareDistributorCredentials(users);const progress=[];
  const result=await provisionDistributors(client,document,async state=>progress.push(clone(state)));
  assert.equal(result.users.filter(user=>user.status==='created').length,2);assert.equal(calls.length,2);
  assert(calls.every(call=>call.email_confirm===true&&call.app_metadata.system_role==='distributor'));
  assert.equal(calls[0].user_metadata.full_name,'Repartidor 1');
  for(const entry of document.users) assert(!JSON.stringify(progress).includes(entry.password));
  await provisionDistributors(client,document,async()=>{});assert.equal(calls.length,2);assert.equal(accounts.length,2);
});
test('An unrelated existing account aborts the entire preflight without creating the other or changing any password',async()=>{
  const {client,accounts,calls}=clientFixture();accounts.push({id:'existing',email:users[1].email,app_metadata:{}});
  await assert.rejects(provisionDistributors(client,prepareDistributorCredentials(users),async()=>{}),/Ya existe/);assert.equal(calls.length,0);
});
test('Preflight checks short pages until the server returns no users',async()=>{
  const {client,calls}=clientFixture();let pages=0;
  client.auth.admin.listUsers=async({page})=>{pages++;return {data:{users:page===1?[{email:'other@example.test'}]:page===2?[{email:users[1].email,app_metadata:{}}]:[]},error:null};};
  await assert.rejects(provisionDistributors(client,prepareDistributorCredentials(users),async()=>{}),/Ya existe/);assert.equal(pages,3);assert.equal(calls.length,0);
});
test('Partial creation keeps the first account and resumes the second safely',async()=>{
  const {client,accounts,calls}=clientFixture();const original=client.auth.admin.createUser;let fail=true;
  client.auth.admin.createUser=async payload=>payload.email===users[1].email&&fail?{data:null,error:{code:'temporary_error'}}:original(payload);
  const document=prepareDistributorCredentials(users);const progress=[];
  await assert.rejects(provisionDistributors(client,document,async state=>progress.push(clone(state))),/No se pudo crear/);
  assert.equal(accounts.length,1);assert.equal(progress.at(-1).users[0].status,'created');
  fail=false;await provisionDistributors(client,document,async()=>{});assert.equal(accounts.length,2);assert.equal(calls.length,2);
});
test('A failed status write after account creation can recover using its server-side batch marker',async()=>{
  const {client,accounts,calls}=clientFixture();const document=prepareDistributorCredentials(users);let writes=0;
  await assert.rejects(provisionDistributors(client,document,async()=>{if(++writes===2) throw new Error('disk error');}),/disk error/);
  assert.equal(accounts.length,1);await provisionDistributors(client,document,async()=>{});assert.equal(accounts.length,2);assert.equal(calls.length,2);
});

test('Validates the shorter credentials and keeps older long records compatible',()=>{
  const document=prepareDistributorCredentials(users);
  assert.equal(validateDistributorCredentials(document)[0].password.length,16);
  document.users[0].password='A'.repeat(36);assert.equal(validateDistributorCredentials(document)[0].password.length,36);
  document.users[0].password='A'.repeat(15);assert.throws(()=>validateDistributorCredentials(document),/16 y 72/);
});
