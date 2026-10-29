import assert from 'node:assert/strict';
import {cleanMetadataCache} from '../cloudflare/public/metadata.mjs';

const now=Date.UTC(2026,8,25),day=24*60*60*1000;
const fresh={status:'ready',description:'a'.repeat(6000),creatorTags:Array.from({length:40},(_,i)=>`etiket-${i}`),fetchedAt:now-24*day};
const input={AbCdEfGhI01:fresh,AbCdEfGhI02:{...fresh,fetchedAt:now-25*day},AbCdEfGhI03:{...fresh,fetchedAt:now+day},invalid:{...fresh,fetchedAt:now-1000},AbCdEfGhI04:{status:'missing',description:'Should vanish',creatorTags:['old'],fetchedAt:now-1000}};
const result=cleanMetadataCache(input,now);
assert.deepEqual(Object.keys(result).sort(),['AbCdEfGhI01','AbCdEfGhI04']);
assert.equal(result.AbCdEfGhI01.description.length,5000);
assert.equal(result.AbCdEfGhI01.creatorTags.length,30);
assert.equal(result.AbCdEfGhI04.description,'');
assert.deepEqual(result.AbCdEfGhI04.creatorTags,[]);
assert.deepEqual(cleanMetadataCache(null,now),{});
console.log('PASS metadata cache: expired and future records removed, fields bounded, missing data cleared');
