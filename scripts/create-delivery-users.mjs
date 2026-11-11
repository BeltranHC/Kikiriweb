import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from './env.mjs';
import { validateDistributorAccounts,prepareDistributorCredentials,validateDistributorCredentials,provisionDistributors } from '../lib/distributor-accounts.mjs';

async function readPrivateJson(file, description) {
  const content=await readFile(file,'utf8');
  try {return JSON.parse(content);} catch {throw new Error(`${description} contiene JSON inv\u00e1lido. Revisa el archivo local; su contenido no se muestra en consola`);}
}

async function main() {
  const prepareOnly=process.argv.includes('--prepare');
  if(process.argv.slice(2).some(arg=>arg!=='--prepare')) throw new Error('Usa npm run create-delivery-users, opcionalmente con -- --prepare');
  const directory=new URL('../artifacts/delivery-accounts/',import.meta.url);
  const planFile=new URL('cuentas.json',directory);const credentialsFile=new URL('credenciales_iniciales.json',directory);const statusFile=new URL('estado_cuentas.json',directory);
  let input;
  try {input=await readPrivateJson(planFile,'El archivo de repartidores');} catch(error) {if(error.code==='ENOENT') throw new Error('Completa artifacts/delivery-accounts/repartidores.json con los dos nombres y correos');throw error;}
  const users=validateDistributorAccounts(input);
  await mkdir(directory,{recursive:true});
  let credentials;
  try {
    credentials=await readPrivateJson(credentialsFile,'El archivo de credenciales');validateDistributorCredentials(credentials);
    if(JSON.stringify(validateDistributorAccounts(credentials.users))!==JSON.stringify(users)) throw new Error('El archivo de credenciales corresponde a otros datos. No se sobrescribirá');
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
    credentials=prepareDistributorCredentials(users);
    // Immutable password record: progress updates never rewrite or truncate these secrets.
    await writeFile(credentialsFile,JSON.stringify(credentials,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  }
  const saveProgress=state=>writeFile(statusFile,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600});
  if(prepareOnly) {
    console.log('Dos credenciales iniciales preparadas en '+fileURLToPath(credentialsFile)+'. No se han creado cuentas ni enviado correos.');return;
  }
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret) {
    await saveProgress({batchId:credentials.batchId,updatedAt:new Date().toISOString(),users:users.map(user=>({...user,status:'pending',userId:null})),reason:'Falta SUPABASE_SECRET_KEY en .env.local'});
    throw new Error('Credenciales preparadas, cuentas pendientes: configura SUPABASE_SECRET_KEY en .env.local y vuelve a ejecutar npm run create-delivery-users');
  }
  const client=createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const state=await provisionDistributors(client,credentials,saveProgress,{role:'delivery'});
  console.log(`${state.users.filter(user=>user.status==='created').length} cuentas de entregas verificadas. Credenciales en ${fileURLToPath(credentialsFile)}. No se muestran contraseñas en consola.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
