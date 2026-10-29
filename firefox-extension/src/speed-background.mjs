// Read only the public video metadata needed to choose a local playback speed.
// The page script returns no account identity, cookies, or playback history.
function validSpeedSender(message,sender){
  if(sender?.id!==browser.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!/^[-\w]{11}$/.test(message?.videoId||''))return false;
  let url;try{url=new URL(sender.url);}catch{return null;}
  return url.origin==='https://www.youtube.com'&&url.pathname==='/watch'&&url.searchParams.get('v')===message.videoId;
}

export async function getSpeedInfo(message,sender){
  if(!validSpeedSender(message,sender))return null;
  try{
    const result=await browser.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:requestedId=>{
      if(location.origin!=='https://www.youtube.com'||location.pathname!=='/watch'||new URL(location.href).searchParams.get('v')!==requestedId)return null;
      const player=document.getElementById('movie_player');
      if(!player||player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting'))return null;
      const response=player.getPlayerResponse?.()||window.ytInitialPlayerResponse;
      const data=player.getVideoData?.();
      const metadata=document.querySelector('ytd-watch-metadata[video-id]');
      const watch=document.querySelector('ytd-watch-flexy[video-id]');
      const videoId=data?.video_id||response?.videoDetails?.videoId||metadata?.getAttribute('video-id')||watch?.getAttribute('video-id');
      if(videoId!==requestedId||response?.videoDetails?.isLive===true)return null;
      const tracks=response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const trackId=response?.streamingData?.adaptiveFormats?.find(format=>format?.audioTrack?.audioIsDefault===true&&typeof format.audioTrack.id==='string')?.audioTrack?.id;
      const captionList=response?.captions?.playerCaptionsTracklistRenderer;
      const captionTrackId=captionList?.audioTracks?.[captionList.defaultAudioTrackIndex]?.audioTrackId;
      const trackLanguage=String(trackId||captionTrackId||'').match(/^([a-z]{2,3}(?:-[a-z0-9]+)*)\.\d+$/i)?.[1]||'';
      const audioLanguage=response?.microformat?.playerMicroformatRenderer?.defaultAudioLanguage||response?.videoDetails?.defaultAudioLanguage||response?.videoDetails?.audioLanguage||trackLanguage;
      const author=data?.author||response?.videoDetails?.author||document.querySelector('ytd-watch-metadata ytd-channel-name a')?.textContent||'';
      return {
        videoId,
        channelName:String(author).trim().slice(0,200),
        audioLanguage:typeof audioLanguage==='string'?audioLanguage.slice(0,30):'',
        captionTracks:Array.isArray(tracks)?tracks.filter(t=>t?.kind==='asr'&&typeof t.languageCode==='string').slice(0,5).map(t=>({kind:'asr',languageCode:t.languageCode.slice(0,30)})):[],
      };
    },args:[message.videoId]});
    return result[0]?.result||null;
  }catch{return null;}
}

export async function setSpeed(message,sender){
  if(!validSpeedSender(message,sender)||![1,1.25,1.5].includes(message.rate))return {ok:false};
  try{
    const result=await browser.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:(requestedId,rate)=>{
      if(location.origin!=='https://www.youtube.com'||location.pathname!=='/watch'||new URL(location.href).searchParams.get('v')!==requestedId)return null;
      const player=document.getElementById('movie_player'),video=player?.querySelector('video.html5-main-video');
      if(!video||player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting'))return null;
      const knownId=player.getVideoData?.()?.video_id||player.getPlayerResponse?.()?.videoDetails?.videoId||document.querySelector('ytd-watch-metadata[video-id]')?.getAttribute('video-id')||document.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
      if(knownId!==requestedId||!Number.isFinite(video.duration)||video.duration<=0)return null;
      if(typeof player.setPlaybackRate==='function')player.setPlaybackRate(rate);
      if(Math.abs(video.playbackRate-rate)>0.001)video.playbackRate=rate;
      return {videoId:requestedId,rate:video.playbackRate};
    },args:[message.videoId,message.rate]});
    const applied=result[0]?.result;
    return {ok:applied?.videoId===message.videoId&&Math.abs(applied.rate-message.rate)<0.001,videoId:applied?.videoId,rate:applied?.rate};
  }catch{return {ok:false};}
}
