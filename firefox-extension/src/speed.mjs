const channelSpeed=new Map([
  ['bora ozkent',1.25],
  ['kanal finans',1.5],
  ['yatirim 101',1.5],
]);

function channelKey(value){
  return String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/ı/g,'i').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function spokenLanguage({audioLanguage,captionTracks}={}){
  if(typeof audioLanguage==='string'&&audioLanguage.trim())return audioLanguage.trim();
  const automatic=Array.isArray(captionTracks)?captionTracks.filter(track=>track?.kind==='asr'&&typeof track.languageCode==='string').map(track=>track.languageCode.toLowerCase().split(/[-_]/)[0]):[];
  // Dubbed videos can expose ASR tracks in several languages. Their order does
  // not identify the spoken/default audio language.
  return new Set(automatic).size===1?automatic[0]:'';
}

export function choosePlaybackSpeed({channelName,audioLanguage,captionTracks}={}){
  const language=spokenLanguage({audioLanguage,captionTracks});
  if(/^en(?:[-_]|$)/i.test(language))return 1;
  return channelSpeed.get(channelKey(channelName))??1.5;
}
