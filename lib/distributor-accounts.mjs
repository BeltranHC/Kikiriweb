import { randomInt,randomUUID } from 'node:crypto';

export function validateDistributorAccounts(users) {
  if(!Array.isArray(users)||users.length!==2) throw new Error('Indica exactamente dos repartidores');
  const emails=new Set();
  return users.map(user=>{
    const name=typeof user?.name==='string'?user.name.trim():'';
    const email=typeof user?.email==='string'?user.email.trim().toLowerCase():'';
    if(!name||name.length>120) throw new Error('Cada repartidor debe tener un nombre de hasta 120 caracteres');
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indica un correo válido para cada repartidor');
    if(emails.has(email)) throw new Error('Los dos correos deben ser diferentes');
    emails.add(email);return {name,email};
  });
}
export function generateDistributorPassword() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-';
  let password;
  do {password=Array.from({length:16},()=>alphabet[randomInt(alphabet.length)]).join('');}
  while(!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)||!/[-!@#$%*+]/.test(password));
  return password;
}
export function prepareDistributorCredentials(users) {
  return {version:1,batchId:randomUUID(),preparedAt:new Date().toISOString(),users:validateDistributorAccounts(users).map(user=>({...user,password:generateDistributorPassword()}))};
}
export function validateDistributorCredentials(document) {
  const users=validateDistributorAccounts(document?.users);
  if(typeof document.batchId!=='string'||!/^[0-9a-f-]{36}$/i.test(document.batchId)) throw new Error('El archivo de credenciales no tiene un identificador válido');
  return users.map((user,index)=>{
    const password=document.users[index].password;
    if(typeof password!=='string'||password.length<16||password.length>72) throw new Error('Las contraseñas iniciales deben tener entre 16 y 72 caracteres');
    return {...user,password};
  });
}
export async function provisionDistributors(client,document,saveProgress) {
  const users=validateDistributorCredentials(document);const wanted=new Set(users.map(user=>user.email));const existing=new Map();let complete=false;
  // Read every page before creating either account. Never reset an existing password.
  for(let page=1;page<=1000;page++) {
    const {data,error}=await client.auth.admin.listUsers({page,perPage:100});
    if(error) throw new Error(`No se pudieron comprobar las cuentas existentes (${error.code||'auth_error'})`);
    const listed=data?.users;if(!Array.isArray(listed)) throw new Error('Respuesta de cuentas inválida');
    for(const user of listed) {const email=(user.email||'').trim().toLowerCase();if(wanted.has(email)) existing.set(email,user);}
    if(!listed.length) {complete=true;break;}
  }
  if(!complete) throw new Error('No se pudo revisar la lista completa de cuentas');
  for(const user of users) {
    const found=existing.get(user.email);
    if(found&&(found.app_metadata?.provisioning_batch_id!==document.batchId||found.app_metadata?.system_role!=='distributor')) {
      throw new Error(`Ya existe ${user.email}. No se reemplazó la cuenta ni se cambió su contraseña`);
    }
  }
  const state={batchId:document.batchId,updatedAt:new Date().toISOString(),users:users.map(({name,email})=>({name,email,status:'pending',userId:null}))};
  await saveProgress(state);
  for(const [index,user] of users.entries()) {
    let account=existing.get(user.email);
    if(!account) {
      const {data,error}=await client.auth.admin.createUser({email:user.email,password:user.password,email_confirm:true,
        user_metadata:{full_name:user.name},app_metadata:{system_role:'distributor',provisioning_batch_id:document.batchId}});
      if(error||!data?.user?.id) {
        state.users[index].error=error?.code||'auth_error';await saveProgress(state);
        throw new Error(`No se pudo crear ${user.email} (${error?.code||'auth_error'}). Las cuentas ya creadas se conservan; puedes reanudar el comando`);
      }
      account=data.user;
    }
    state.users[index]={name:user.name,email:user.email,status:'created',userId:account.id};state.updatedAt=new Date().toISOString();
    await saveProgress(state);
  }
  return state;
}
