import assert from 'node:assert/strict';

const id='00000000001';
const sender={id:'extension',frameId:0,url:`https://www.youtube.com/watch?v=${id}`,tab:{id:7}};
const calls=[];
let ad=false;
let data={video_id:id,author:'Bora Özkent'};
let domVideoId=null,domChannelName='';
let response={
  videoDetails:{videoId:id,author:'Response author',title:'A private title',isLive:false},
  microformat:{playerMicroformatRenderer:{defaultAudioLanguage:'en-US'}},
  captions:{playerCaptionsTracklistRenderer:{captionTracks:[
    {kind:'asr',languageCode:'tr',baseUrl:'private-caption-url'},
    {languageCode:'en',baseUrl:'private-manual-caption-url'},
    {kind:'asr',languageCode:'en',baseUrl:'private-english-caption-url'},
  ]}},
};
const player={
  classList:{contains(name){return ad&&(name==='ad-showing'||name==='ad-interrupting');}},
  getVideoData(){return data;},
  getPlayerResponse(){return response;},
};
globalThis.location=new URL(sender.url);
globalThis.document={
  getElementById(name){return name==='movie_player'?player:null;},
  querySelector(selector){
    if(selector.includes('channel-name')||selector.includes('#owner'))return domChannelName?{textContent:domChannelName,innerText:domChannelName,href:'https://www.youtube.com/@Yatirim101'}:null;
    if(selector.includes('ytd-watch-metadata')||selector.includes('ytd-watch-flexy'))return domVideoId?{getAttribute(name){return name==='video-id'?domVideoId:null;},dataset:{videoId:domVideoId}}:null;
    return null;
  },
};
globalThis.window={ytInitialPlayerResponse:response,ytcfg:{data_:{DATASYNC_ID:'private-account-id',INNERTUBE_API_KEY:'private-api-key'}}};
globalThis.browser={runtime:{id:'extension'},scripting:{async executeScript(options){calls.push(options);return [{result:options.func(...options.args)}];}}};
const {getSpeedInfo,setSpeed}=await import('../firefox-extension/src/speed-background.mjs');

for(const badSender of [
  {...sender,id:'other'},
  {...sender,frameId:1},
  {...sender,url:`https://evil.test/watch?v=${id}`},
  {...sender,tab:null},
  {...sender,tab:{id:'7'}},
])assert.equal(await getSpeedInfo({videoId:id},badSender),null);
assert.equal(await getSpeedInfo({videoId:'invalid'},sender),null);
assert.equal(calls.length,0,'invalid senders and IDs must never inject page code');

const info=await getSpeedInfo({videoId:id},sender);
assert.deepEqual(info,{
  videoId:id,channelName:'Bora Özkent',audioLanguage:'en-US',
  captionTracks:[{kind:'asr',languageCode:'tr'},{kind:'asr',languageCode:'en'}],
});
assert.deepEqual(Object.keys(info).sort(),['audioLanguage','captionTracks','channelName','videoId']);
assert(!JSON.stringify(info).includes('private-'),'account, API key, title and caption URLs must not leave the page');
assert.equal(calls[0].world,'MAIN');
assert.deepEqual(calls[0].target,{tabId:7,frameIds:[0]});
assert.deepEqual(calls[0].args,[id]);

ad=true;assert.equal(await getSpeedInfo({videoId:id},sender),null,'ads must not set a video speed');ad=false;
data={...data,video_id:'00000000002'};
assert.equal(await getSpeedInfo({videoId:id},sender),null,'player data must match the requested video');
data={...data,video_id:id};
location=new URL('https://www.youtube.com/watch?v=00000000002');
assert.equal(await getSpeedInfo({videoId:id},sender),null,'stale page navigation must not return metadata');
location=new URL('https://www.youtube.com/shorts/'+id);
assert.equal(await getSpeedInfo({videoId:id},sender),null,'only normal watch pages are eligible');
location=new URL(sender.url);
response={...response,videoDetails:{...response.videoDetails,isLive:true}};
assert.equal(await getSpeedInfo({videoId:id},sender),null,'live streams are excluded');

response={...response,videoDetails:{...response.videoDetails,isLive:false,audioLanguage:'tr'},microformat:{playerMicroformatRenderer:{} }};
data=null;
assert.deepEqual(await getSpeedInfo({videoId:id},sender),{
  videoId:id,channelName:'Response author',audioLanguage:'tr',
  captionTracks:[{kind:'asr',languageCode:'tr'},{kind:'asr',languageCode:'en'}],
},'metadata falls back to player response when video data is absent');

response={...response,videoDetails:{videoId:id,author:'Yatırım 101',isLive:false},streamingData:{adaptiveFormats:[
  {audioTrack:{id:'en-US.10',audioIsDefault:false,isAutoDubbed:true}},
  {audioTrack:{id:'tr.4',audioIsDefault:true}},
]}};
assert.equal((await getSpeedInfo({videoId:id},sender)).audioLanguage,'tr','default Turkish audio beats English ASR captions in a dubbed video');

delete player.getVideoData;
delete player.getPlayerResponse;
window.ytInitialPlayerResponse=null;
domVideoId=id;domChannelName='Yatırım 101';
assert.deepEqual(await getSpeedInfo({videoId:id},sender),{
  videoId:id,channelName:'Yatırım 101',audioLanguage:'',captionTracks:[],
},'matching watch-page DOM channel metadata works when YouTube player methods are unavailable');
domVideoId='00000000002';
assert.equal(await getSpeedInfo({videoId:id},sender),null,'DOM metadata for another video must not be used');

const video={duration:300,playbackRate:1};
const playerRateCalls=[];
player.querySelector=selector=>selector==='video.html5-main-video'?video:null;
player.getVideoData=()=>({video_id:id});
player.setPlaybackRate=rate=>{playerRateCalls.push(rate);video.playbackRate=rate;};
domVideoId=id;
const callCount=calls.length;
for(const badSender of [
  {...sender,id:'other'},
  {...sender,frameId:1},
  {...sender,url:`https://evil.test/watch?v=${id}`},
  {...sender,url:`https://www.youtube.com/watch?v=00000000002`},
  {...sender,tab:null},
])assert.equal((await setSpeed({videoId:id,rate:1.5},badSender)).ok,false);
for(const badRequest of [
  {videoId:'invalid',rate:1.5},
  {videoId:id,rate:0},
  {videoId:id,rate:1.75},
  {videoId:id,rate:'1.5'},
  {videoId:id,rate:NaN},
])assert.equal((await setSpeed(badRequest,sender)).ok,false);
assert.equal(calls.length,callCount,'invalid speed requests must never inject page code');

assert.deepEqual(await setSpeed({videoId:id,rate:1.5},sender),{ok:true,videoId:id,rate:1.5});
assert.deepEqual(playerRateCalls,[1.5],'use the YouTube player API when available');
assert.equal(video.playbackRate,1.5);
assert.equal(calls.at(-1).world,'MAIN');
assert.deepEqual(calls.at(-1).target,{tabId:7,frameIds:[0]});
assert.deepEqual(calls.at(-1).args,[id,1.5]);

ad=true;
assert.equal((await setSpeed({videoId:id,rate:1.25},sender)).ok,false,'ads must not receive the video speed');
ad=false;
player.getVideoData=()=>({video_id:'00000000002'});
assert.equal((await setSpeed({videoId:id,rate:1.25},sender)).ok,false,'a stale player video ID must not receive the speed');
player.getVideoData=()=>({video_id:id});
location=new URL('https://www.youtube.com/watch?v=00000000002');
assert.equal((await setSpeed({videoId:id,rate:1.25},sender)).ok,false,'a navigated page must not receive the prior video speed');
location=new URL(sender.url);

delete player.getVideoData;
delete player.setPlaybackRate;
video.playbackRate=1;
assert.deepEqual(await setSpeed({videoId:id,rate:1.25},sender),{ok:true,videoId:id,rate:1.25});
assert.equal(video.playbackRate,1.25,'the DOM video rate is used when the player API is unavailable');
assert.deepEqual(playerRateCalls,[1.5],'the DOM fallback does not call a missing player API');

console.log('PASS speed background: guarded metadata and playback-rate changes via player API or DOM fallback.');
