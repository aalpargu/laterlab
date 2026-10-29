import assert from 'node:assert/strict';
import {createPlaylistTools} from '../cloudflare/public/exporter.mjs';
import {importSnapshot,exclusion} from '../cloudflare/public/core.mjs';
const kit=createPlaylistTools();
const command=token=>({continuationCommand:{token}});
const variants={
  direct:token=>({continuationItemRenderer:{continuationEndpoint:command(token)}}),
  executor:token=>({continuationItemRenderer:{continuationEndpoint:{commandExecutorCommand:{commands:[{clickTrackingParams:'ignored'},command(token)]}}}}),
  button:token=>({continuationItemRenderer:{button:{buttonRenderer:{command:command(token)}}}}),
  buttonExecutor:token=>({continuationItemRenderer:{button:{buttonRenderer:{command:{commandExecutorCommand:{commands:[command(token)]}}}}}}),
  buttonService:token=>({continuationItemRenderer:{button:{buttonRenderer:{serviceEndpoint:command(token)}}}}),
  viewModel:token=>({continuationItemViewModel:{continuationCommand:{innertubeCommand:command(token)}}}),
  wrapped:token=>({continuationItemRenderer:{continuationEndpoint:{innertubeCommand:command(token)}}})
};
const row=i=>({playlistVideoRenderer:{videoId:String(i).padStart(11,'0'),index:{simpleText:String(i)},title:{simpleText:'How to learn Python'},setVideoId:'entry-'+i}});
const first=items=>({header:{sortFilterSubMenuRenderer:{subMenuItems:[{title:'Date added (oldest)',selected:true}]}},contents:{playlistVideoListRenderer:{contents:items}}});
const next=items=>({onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'playlist-video-list',continuationItems:items}}]});
for(const [name,make] of Object.entries(variants)){
  assert.equal(kit.page(first([row(1),make('page-2')])).next,'page-2',name);
  let requests=0;
  const result=await kit.scan({expected:3087,checkpoint:{},request:async body=>{
    requests++;
    const start=body.continuation?Number(body.continuation.slice(5)):1;
    const end=Math.min(start+99,3087), items=Array.from({length:end-start+1},(_,i)=>row(start+i));
    if(end<3087)items.push(make('page-'+(end+1)));
    return body.continuation?next(items):first(items);
  }});
  assert.equal(result.videos.length,3087,name);
  assert.equal(requests,32,name);
  const imported=importSnapshot(result);
  assert.equal(imported.filter(v=>!exclusion(v)).length,1813,name);
  assert.equal(exclusion(imported[1273]),'İlk 1274');assert.equal(exclusion(imported[1274]),'');
}
// Duplicate representations may agree. Conflicting continuation commands must
// never silently choose a different playlist or recommendation feed.
assert.equal(kit.page(first([row(1),{continuationItemRenderer:{continuationEndpoint:command('same'),button:{buttonRenderer:{command:command('same')}}}}])).next,'same');
assert.throws(()=>kit.page(first([row(1),{continuationItemRenderer:{continuationEndpoint:command('one'),button:{buttonRenderer:{command:command('two')}}}}])),/Birden fazla/);
assert.throws(()=>kit.page(first([row(1),{continuationItemRenderer:{continuationEndpoint:{unrelated:{token:'secret-value'}}}}])),/anahtarı okunamadı/);
assert.throws(()=>kit.page(first([row(1),{continuationItemRenderer:{continuationEndpoint:command({bad:'not-a-string'})}}])),/anahtarı okunamadı/);
const unrelated=next([row(1),variants.executor('correct')]);
unrelated.onResponseReceivedActions.push({appendContinuationItemsAction:{targetId:'playlist-recommendations',continuationItems:[row(99),variants.button('wrong')]}});
unrelated.menu={continuationCommand:{token:'also-wrong'}};
assert.equal(kit.page(unrelated).next,'correct');
assert.equal(kit.page(next([variants.executor('empty-page-next')])).next,'empty-page-next');
console.log('PASS: 7 continuation formats, 3,087 records for each, 1–1274 exclusion, duplicate/conflicting/malformed tokens, unrelated feeds ignored and empty continuation page.');
