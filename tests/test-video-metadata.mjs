import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import worker from '../cloudflare/sync-worker.mjs';

const base='https://laterlab.example';
const token='a'.repeat(64);
const apiKey='test-key-not-a-secret';
const id1='AbCdEfGhI01',id2='AbCdEfGhI02';
const env={
  YOUTUBE_API_KEY:apiKey,
  SYNC_AUTH_HASH:createHash('sha256').update(token).digest('hex'),
  LIBRARIES:{idFromName:()=>1,get:()=>({fetch:()=>new Response('sync worked')})},
  ASSETS:{fetch:()=>new Response('asset worked')}
};
function request(ids,{headers={},method='POST',body=JSON.stringify({ids})}={}){
  return new Request(`${base}/api/video-metadata`,{method,headers:{Origin:base,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:method==='POST'?body:undefined});
}

test('returns only description, tags and missing IDs from the official API',async()=>{
  const originalFetch=globalThis.fetch;
  let upstreamCalls=0;
  globalThis.fetch=async (url,options)=>{
    upstreamCalls++;
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://www.googleapis.com');
    assert.equal(parsed.pathname,'/youtube/v3/videos');
    assert.equal(parsed.searchParams.get('part'),'snippet');
    assert.equal(parsed.searchParams.get('id'),`${id1},${id2}`);
    assert.equal(parsed.searchParams.get('key'),apiKey);
    assert.equal(options.headers.Accept,'application/json');
    return Response.json({items:[{id:id1,snippet:{title:'ignored',description:'BIST 100 analizi',tags:['borsa','BIST']}},{id:'OtherVideo1',snippet:{description:'ignored'}}]});
  };
  try{
    const response=await worker.fetch(request([id1,id2]),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(await response.json(),{videos:[{id:id1,description:'BIST 100 analizi',tags:['borsa','BIST']}],missingIds:[id2]});
    assert.equal(upstreamCalls,1);
  }finally{globalThis.fetch=originalFetch}
});

test('rejects unauthenticated, cross-origin and invalid metadata requests before YouTube',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('YouTube should not be called')};
  try{
    assert.equal((await worker.fetch(request([id1],{headers:{Authorization:''}}),env)).status,401);
    assert.equal((await worker.fetch(request([id1],{headers:{Origin:'https://attacker.example'}}),env)).status,403);
    assert.equal((await worker.fetch(request([id1],{headers:{Origin:''}}),env)).status,403);
    assert.equal((await worker.fetch(request([id1],{headers:{Origin:'moz-extension://12345678-1234-1234-1234-123456789abc'}}),env)).status,403);
    for(const ids of [[id1,id1],['invalid'],Array.from({length:51},(_,i)=>`AbCdEfGh${String(i).padStart(3,'0')}`)]){
      assert.equal((await worker.fetch(request(ids),env)).status,400);
    }
    assert.equal((await worker.fetch(request([id1],{method:'GET'}),env)).status,405);
    assert.equal((await worker.fetch(request([id1],{headers:{'Content-Type':'text/plain'}}),env)).status,415);
    assert.equal((await worker.fetch(request([id1],{body:' '.repeat(4097)}),env)).status,413);
  }finally{globalThis.fetch=originalFetch}
});

test('reports unavailable metadata without disclosing the API key and preserves sync',async()=>{
  const missingKey=await worker.fetch(request([id1]),{...env,YOUTUBE_API_KEY:undefined});
  assert.equal(missingKey.status,503);
  assert.equal((await missingKey.json()).available,false);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:{message:`bad ${apiKey}`}},{status:403});
  try{
    const response=await worker.fetch(request([id1]),env);
    assert.equal(response.status,503);
    assert.equal((await response.text()).includes(apiKey),false);
  }finally{globalThis.fetch=originalFetch}
  const sync=await worker.fetch(new Request(`${base}/api/sync`,{headers:{Origin:base,Authorization:`Bearer ${token}`}}),env);
  assert.equal(await sync.text(),'sync worked');
});
