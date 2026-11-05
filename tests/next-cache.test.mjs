import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { prepareNextCache } from '../scripts/next-cache.mjs';

async function fixture(run) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kikiri-cache-test-'));
  try { await run(temporary); }
  finally { assert(path.basename(temporary).startsWith('kikiri-cache-test-')); await rm(temporary, { recursive: true, force: true }); }
}
test('Cleaning development output preserves sources, private files, production output and the directory identity', () => fixture(async project => {
  await mkdir(path.join(project,'.next-dev','server'),{recursive:true});
  await mkdir(path.join(project,'.next'),{recursive:true});
  await writeFile(path.join(project,'.next-dev','server','pages-manifest.json'),'broken');
  await writeFile(path.join(project,'.next','sentinel'),'production');
  await writeFile(path.join(project,'.env.local'),'private');await writeFile(path.join(project,'database.sql'),'source');
  if(process.platform==='win32')await writeFile(path.join(project,'.next-dev')+':kikiri-test-marker','preserved');
  const result=await prepareNextCache(project,'development');assert.deepEqual(await readdir(result.directory),[]);
  for(const [file,value]of [['.next/sentinel','production'],['.env.local','private'],['database.sql','source']])assert.equal(await readFile(path.join(project,file),'utf8'),value);
  if(process.platform==='win32')assert.equal(await readFile(result.directory+':kikiri-test-marker','utf8'),'preserved');
}));
test('Invalid modes and files in place of output directories are rejected before deleting anything',()=>fixture(async project=>{
  await writeFile(path.join(project,'source'),'keep');await assert.rejects(prepareNextCache(project,'../'),/Modo de limpieza invalido/);
  await writeFile(path.join(project,'.next-dev'),'keep');await assert.rejects(prepareNextCache(project,'development'),/sin enlaces/);
  assert.equal(await readFile(path.join(project,'.next-dev'),'utf8'),'keep');assert.equal(await readFile(path.join(project,'source'),'utf8'),'keep');
}));
test('An output junction cannot redirect cleanup outside the generated directory',()=>fixture(async temporary=>{
  const project=path.join(temporary,'project'),outside=path.join(temporary,'outside');await mkdir(project);await mkdir(outside);await writeFile(path.join(outside,'keep'),'safe');
  await symlink(outside,path.join(project,'.next-dev'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareNextCache(project,'development'),/sin enlaces/);assert.equal(await readFile(path.join(outside,'keep'),'utf8'),'safe');
}));
test('Windows Dropbox output stays ignored on repeated preparations while its parent and sibling sources stay untouched',{skip:process.platform!=='win32'},()=>fixture(async temporary=>{
  const project=path.join(temporary,'Dropbox','project');await mkdir(project,{recursive:true});await writeFile(path.join(project,'source'),'keep');
  const result=await prepareNextCache(project,'development');assert.equal(result.dropboxIgnored,true);assert.equal(await readFile(result.directory+':com.dropbox.ignored','utf8'),'1');
  await mkdir(path.join(result.directory,'server'));await writeFile(path.join(result.directory,'server','pages-manifest.json'),'{}');await prepareNextCache(project,'development');
  assert.equal(await readFile(result.directory+':com.dropbox.ignored','utf8'),'1');assert.equal(await readFile(path.join(project,'source'),'utf8'),'keep');
  await assert.rejects(readFile(project+':com.dropbox.ignored'),error=>error.code==='ENOENT');
}));

test('Production cleanup selects only .next while development files remain intact',()=>fixture(async project=>{
  await mkdir(path.join(project,'.next'));await mkdir(path.join(project,'.next-dev'));await writeFile(path.join(project,'.next','old'),'remove');await writeFile(path.join(project,'.next-dev','keep'),'development');
  const result=await prepareNextCache(project);assert.equal(path.basename(result.directory),'.next');assert.deepEqual(await readdir(result.directory),[]);assert.equal(await readFile(path.join(project,'.next-dev','keep'),'utf8'),'development');
}));
