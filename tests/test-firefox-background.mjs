import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {newPairCode,keysFor,encryptDocument,decryptDocument,documentOf} from '../cloudflare/public/sync-core.mjs';
import {normalizeVideo} from '../cloudflare/public/core.mjs';
import {cleanStudio} from '../cloudflare/public/features.mjs';

const event=()=>({listeners:new Set(),addListener(fn){this.listeners.add(fn)},removeListener(fn){this.listeners.delete(fn)},async fire(...args){for(const fn of [...this.listeners])await fn(...args)}});
const store=()=>({values:{},async get(keys){return Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,this.values[k]]))},async set(obj){Object.assign(this.values,structuredClone(obj))},async remove(keys){for(const k of typeof keys==='string'?[keys]:keys)delete this.values[k]}});
const local=store(),session=store(),tabs=new Map(),created=[],removed=[],messages=event(),alarmEvent=event(),alarms=new Map();let nextTab=1,scriptMode='success',release=null,uploads=0,appCode=null;
const id=n=>String(n).padStart(11,'0'),code=newPairCode(),keys=await keysFor(code),ext='test-extension',origin='moz-extension://11111111-2222-3333-4444-555555555555/';
let cloud=documentOf({videos:[normalizeVideo({id:id(1),libraryOrder:1,notes:'Keep me'})],studio:cleanStudio(),settings:{},plans:{}}),revision=1;
const browser={storage:{local,session},action:{onClicked:event(),async setBadgeText(){},async setBadgeBackgroundColor(){}},runtime:{id:ext,getURL:path=>origin+path,onMessage:messages,onInstalled:event(),onStartup:event(),async openOptionsPage(){}},alarms:{onAlarm:alarmEvent,async get(name){return alarms.get(name)},async create(name,value){alarms.set(name,{...value,scheduledTime:Date.now()+(value.delayInMinutes||0)*60000})},async clear(name){return alarms.delete(name)}},tabs:{onUpdated:event(),onRemoved:event(),async create(options){const tab={id:nextTab++,status:'complete',...options};tabs.set(tab.id,tab);created.push(tab);return tab},async get(id){if(!tabs.has(id))throw Error('missing');return tabs.get(id)},async remove(id){removed.push(id);tabs.delete(id);await this.onRemoved.fire(id)},async query(){return [...tabs.values()].filter(t=>t.url.startsWith('https://siradaki.alpargu37.workers.dev'))}},scripting:{async executeScript(options){
  if(options.files)return [{result:undefined}];
  if(!options.args)return [{result:appCode}];
  const ids=options.args[0];
  if(scriptMode==='wait')await new Promise(resolve=>release=resolve);
  if(scriptMode==='fail')return [{result:{ok:false,error:'YouTube hesabı değişmiş.'}}];
  return [{result:{ok:true,value:{account:'a'.repeat(64),delta:{format:'siradaki-delta-v1',scope:'new-only',order:'newest',complete:true,baseIds:ids,matchedIds:[id(1)],stopReason:'end',scanned:2,total:2,videos:ids.includes(id(2))?[]:[{id:id(2),title:'New video',position:null}],exportedAt:new Date().toISOString()}}}}];
}}};
const fetcher=async(url,options)=>{assert.equal(url,'https://siradaki.alpargu37.workers.dev/api/sync');if(options.method==='PUT'){const data=JSON.parse(options.body);assert.equal(data.expectedRevision,revision);cloud=await decryptDocument(data.payload,keys.key);uploads++;return Response.json({revision:++revision})}return Response.json({revision,payload:await encryptDocument(cloud,keys.key)})};
const sandbox={browser,crypto:webcrypto,fetch:fetcher,TextEncoder,TextDecoder,AbortSignal,Response,URL,structuredClone,btoa,atob,setTimeout,clearTimeout,console};
vm.runInNewContext(fs.readFileSync(new URL('../firefox-extension/background.js',import.meta.url),'utf8'),sandbox);
const handler=[...messages.listeners][0],sender={id:ext,url:origin+'options.html'},send=(action,extra={})=>handler({action,...extra},sender);
const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}throw Error('test condition timed out')};
assert.equal(await handler({action:'connect-file',code},{id:ext,url:'https://www.youtube.com/'}),undefined,'web pages cannot trigger privileged operations');
appCode=code;assert.equal((await send('connect-app')).ok,true);await until(()=>local.values.status?.phase==='success');await until(()=>!tabs.size);
assert.equal(uploads,1);assert.equal(cloud.videos[0].notes,'Keep me');assert.equal(cloud.videos.length,2);assert.equal(local.values.config.account,'a'.repeat(64));assert.equal(alarms.get('sync').periodInMinutes,360);assert(created.every(t=>t.active===false));assert.equal(local.values.lastSuccess.added,1);
const state=await send('state');assert.equal(state.connected,true);assert(!JSON.stringify(state).includes(code),'options status must not expose the key');assert(!session.values.ownedTab);
assert.equal((await send('enabled',{enabled:false})).ok,true);assert(!alarms.has('sync'));assert.equal((await send('now')).ok,false);
scriptMode='wait';await send('enabled',{enabled:true});await until(()=>!!release);const pending=release;
await send('enabled',{enabled:false});pending();await until(()=>local.values.status?.phase==='error');await until(()=>!tabs.size);assert.equal(uploads,1,'paused in-flight scan cannot write');
scriptMode='fail';await send('enabled',{enabled:true});await until(()=>local.values.status?.phase==='error'&&local.values.status.message.includes('hesabı'));assert.equal(uploads,1,'failed scan cannot write');await until(()=>!tabs.size);
await send('disconnect');assert.equal((await send('state')).connected,false);assert(!local.values.lastCloudBackup);assert.equal(cloud.videos.length,2);
// Session-scoped stale tabs are cleaned before the next scan, not confused with user tabs after restart.
const old=await browser.tabs.create({url:'https://www.youtube.com/playlist?list=WL',active:false});await session.set({ownedTab:{id:old.id}});scriptMode='success';await send('connect-file',{code});await until(()=>local.values.status?.phase==='success');await until(()=>!tabs.size);assert(removed.includes(old.id));assert.equal(uploads,2);
console.log('PASS Firefox background: app pairing without code reentry, scheduled scan, protected messages, metadata, tab cleanup, pause during scan prevents upload, account failure, disconnect preserves cloud, suspended-page recovery.');

