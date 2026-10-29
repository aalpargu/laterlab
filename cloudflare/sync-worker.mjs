const MAX_BYTES=28*1024*1024,CHUNK=64000,METADATA_MAX_BYTES=4096;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function videoMetadata(request,apiKey){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return json({error:'JSON gerekli.'},415);
  if(Number(request.headers.get('Content-Length'))>METADATA_MAX_BYTES)return json({error:'İstek çok büyük.'},413);
  let input;
  try{
    const reader=request.body?.getReader();if(!reader)return json({error:'İstek boş.'},400);
    const chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>METADATA_MAX_BYTES){await reader.cancel();return json({error:'İstek çok büyük.'},413)}chunks.push(value)}
    const body=new Uint8Array(length);let offset=0;for(const part of chunks){body.set(part,offset);offset+=part.length}
    input=JSON.parse(new TextDecoder().decode(body));
  }catch{return json({error:'Geçersiz JSON.'},400)}
  const ids=input?.ids;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(id))||new Set(ids).size!==ids.length)return json({error:'1–50 farklı, geçerli YouTube video kimliği gerekli.'},400);
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part','snippet');
  url.searchParams.set('id',ids.join(','));
  url.searchParams.set('fields','items(id,snippet(description,tags))');
  url.searchParams.set('key',apiKey);
  try{
    const response=await fetch(url.toString(),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return json({available:false,error:'YouTube video bilgilerine şu anda ulaşılamıyor.'},503);
    const data=await response.json();
    if(!Array.isArray(data?.items))throw Error('Invalid YouTube response');
    const requested=new Set(ids),byId=new Map();
    for(const item of data.items){
      if(!requested.has(item?.id)||!item.snippet)continue;
      byId.set(item.id,{id:item.id,description:typeof item.snippet.description==='string'?item.snippet.description:'',tags:Array.isArray(item.snippet.tags)?item.snippet.tags.filter(tag=>typeof tag==='string'):[]});
    }
    return json({videos:ids.filter(id=>byId.has(id)).map(id=>byId.get(id)),missingIds:ids.filter(id=>!byId.has(id))});
  }catch{return json({available:false,error:'YouTube video bilgilerine şu anda ulaşılamıyor.'},503)}
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/sync-status')return json({available:!!env.LIBRARIES&&!!env.SYNC_AUTH_HASH,version:1});
  if(url.pathname!=='/api/sync'&&url.pathname!=='/api/video-metadata')return env.ASSETS.fetch(request);
  if(!env.LIBRARIES||!env.SYNC_AUTH_HASH)return json({error:'Eşitleme sunucusu henüz kurulmadı.'},503);
  if((url.pathname==='/api/sync'&&!['GET','PUT'].includes(request.method))||(url.pathname==='/api/video-metadata'&&request.method!=='POST'))return json({error:'Yöntem desteklenmiyor.'},405);
  const origin=request.headers.get('Origin');
  if(url.pathname==='/api/video-metadata'){
    if(origin!==url.origin)return json({error:'İstek kaynağı reddedildi.'},403);
  }else if(origin&&origin!==url.origin&&!/^moz-extension:\/\/[a-f0-9-]{36}$/.test(origin))return json({error:'İstek kaynağı reddedildi.'},403);
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return json({error:'Eşitleme kodu gerekli.'},401);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==env.SYNC_AUTH_HASH)return json({error:'Eşitleme kodu bu kütüphaneye ait değil.'},401);
  if(url.pathname==='/api/video-metadata'){
    if(typeof env.YOUTUBE_API_KEY!=='string'||!env.YOUTUBE_API_KEY.trim())return json({available:false,error:'Video bilgisi hizmeti henüz kurulmadı.'},503);
    return videoMetadata(request,env.YOUTUBE_API_KEY);
  }
  const id=env.LIBRARIES.idFromName('personal-library-v1');
  return env.LIBRARIES.get(id).fetch(request);
}};
// SQLite-backed Durable Object: compare-and-swap and chunk writes are one transaction.
export class LibraryStore {
  constructor(ctx){this.storage=ctx.storage}
  async fetch(request){
    if(request.method==='GET')return this.storage.transaction(async tx=>{
      const meta=await tx.get('meta');if(!meta)return json({revision:0,payload:null});
      if(request.headers.get('If-None-Match')===String(meta.revision))return new Response(null,{status:304,headers:{'Cache-Control':'no-store'}});
      const parts=[];for(let i=0;i<meta.parts;i++)parts.push(await tx.get('part:'+i));
      return json({revision:meta.revision,payload:JSON.parse(parts.join(''))});
    });
    if(request.method!=='PUT')return json({error:'Yöntem desteklenmiyor.'},405);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON gerekli.'},415);
    if(Number(request.headers.get('Content-Length'))>MAX_BYTES)return json({error:'Dosya çok büyük.'},413);
    let data;try{
      const reader=request.body?.getReader();if(!reader)return json({error:'İstek boş.'},400);const chunks=[];let length=0;
      while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();return json({error:'Dosya çok büyük.'},413)}chunks.push(value)}
      const body=new Uint8Array(length);let offset=0;for(const part of chunks){body.set(part,offset);offset+=part.length}data=JSON.parse(new TextDecoder().decode(body));
    }catch{return json({error:'Geçersiz JSON.'},400)}
    if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||!/^[A-Za-z0-9_-]{16}$/.test(data.payload?.iv||'')||typeof data.payload?.ciphertext!=='string'||!/^[A-Za-z0-9_-]{22,}$/.test(data.payload.ciphertext))return json({error:'Geçersiz şifreli kayıt.'},400);
    const body=JSON.stringify(data.payload),parts=Math.ceil(body.length/CHUNK);
    return this.storage.transaction(async tx=>{
      const previous=await tx.get('meta');if((previous?.revision||0)!==data.expectedRevision)return json({error:'Kayıt başka cihazda değişti.'},409);
      for(let i=0;i<parts;i++)await tx.put('part:'+i,body.slice(i*CHUNK,(i+1)*CHUNK));
      for(let i=parts;i<(previous?.parts||0);i++)await tx.delete('part:'+i);
      const revision=data.expectedRevision+1;await tx.put('meta',{revision,parts});return json({revision});
    });
  }
}
