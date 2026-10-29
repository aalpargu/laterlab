// Metadata search. Terms come from the query and the video's own text; there is
// deliberately no fixed list of subjects, synonyms, or categories here.
const TOKEN_RE=/[\p{L}\p{N}]+/gu;
const URL_RE=/(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE=/\b\S+@\S+\.\S+\b/g;
const cache=new WeakMap();

export const normalizeSearchText=value=>String(value??'').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');

function tokens(text){
  return [...String(text).matchAll(TOKEN_RE)].map(match=>({word:normalizeSearchText(match[0]),start:match.index,end:match.index+match[0].length}));
}

// A short Turkish inflection, such as borsası/borsada, may differ between the
// query and metadata. This is a spelling aid, not a topic or synonym mapping.
const suffixes=['larindan','lerinden','larinin','lerinin','larina','lerine','larini','lerini','sindan','sinden','sinda','sinde','sini','sunu','sina','sine','larin','lerin','lari','leri','lardan','lerden','larda','lerde','lar','ler','dan','den','tan','ten','nda','nde','nin','nun','ina','ine','ini','unu','si','su','da','de','ta','te'];
function stem(word){
  for(const suffix of suffixes)if(word.endsWith(suffix)&&word.length-suffix.length>=4)return word.slice(0,-suffix.length);
  return word;
}
function wordQuality(query,actual){
  if(query===actual)return 1;
  if(query.length<4||actual.length<4)return 0;
  if(actual.startsWith(query))return .82;
  if(stem(query)===stem(actual))return .72;
  return 0;
}

export function prepareSearchQuery(input){
  const phrase=tokens(String(input??'').slice(0,200)).map(token=>token.word).slice(0,12);
  return {phrase,terms:[...new Set(phrase)]};
}

function metadataFor(video,lookup){
  if(!lookup)return null;
  const row=lookup instanceof Map?lookup.get(video.id):typeof lookup==='function'?lookup(video.id):lookup[video.id];
  return row&&typeof row==='object'?row:null;
}

function fingerprint(video,metadata){
  const tags=Array.isArray(video.tags)?video.tags.map(String):[];
  const creatorTags=Array.isArray(metadata?.creatorTags)?metadata.creatorTags:Array.isArray(video.creatorTags)?video.creatorTags:[];
  return [String(video.title??''),String(video.channel??''),String(video.notes??''),String(metadata?.description??video.description??''),tags.join('\u0000'),creatorTags.map(String).join('\u0000')];
}

function fieldsFor(video,metadata){
  const stamp=fingerprint(video,metadata),previous=cache.get(video);
  if(previous&&stamp.every((value,index)=>value===previous.stamp[index]))return previous.fields;
  const fields=[];
  const add=(field,label,text,weight)=>{
    text=String(text??'').trim();
    if(text)fields.push({field,label,text,normalized:normalizeSearchText(text),weight});
  };
  add('title','Başlık',stamp[0],12);
  add('notes','Notun',stamp[2],10);
  for(const tag of (Array.isArray(video.tags)?video.tags:[]).slice(0,20))add('tags','Etiketin',tag,9);
  const creatorTags=Array.isArray(metadata?.creatorTags)?metadata.creatorTags:Array.isArray(video.creatorTags)?video.creatorTags:[];
  for(const tag of creatorTags.slice(0,40))add('creatorTags','Video etiketi',tag,8);
  add('channel','Kanal',stamp[1],3);
  const lines=stamp[3].slice(0,10000).split(/\r?\n+/).slice(0,80);
  let contentLine=0;
  for(const line of lines){
    const cleaned=line.replace(URL_RE,' ').replace(EMAIL_RE,' ').trim();
    if(!cleaned)continue;
    const hashtags=(line.match(/#/g)||[]).length;
    const handles=(line.match(/@[\p{L}\p{N}_]+/gu)||[]).length;
    const hasLinks=/(?:https?:\/\/|www\.)/i.test(line);
    // Link lists and tag walls tend to be reused in every video description.
    const boilerplate=hashtags>=4||handles>=2||(hasLinks&&cleaned.length<100);
    add('description','Açıklama',cleaned,boilerplate?1.5:contentLine<3?6:contentLine<10?4.5:3);
    contentLine++;
  }
  cache.set(video,{stamp,fields});
  return fields;
}

function minimumSpan(hits,termCount){
  if(termCount<2)return 1;
  const counts=Array(termCount).fill(0);
  let have=0,left=0,best=Infinity;
  for(let right=0;right<hits.length;right++){
    if(!counts[hits[right].term]++)have++;
    while(have===termCount){
      best=Math.min(best,hits[right].index-hits[left].index+1);
      if(!--counts[hits[left].term])have--;
      left++;
    }
  }
  return best;
}

function fieldMatch(field,query){
  if(!query.terms.some(term=>field.normalized.includes(term.slice(0,Math.min(4,term.length)))))return null;
  const words=tokens(field.text),best=Array(query.terms.length).fill(0),hits=[];
  for(let index=0;index<words.length;index++)for(let term=0;term<query.terms.length;term++){
    const quality=wordQuality(query.terms[term],words[index].word);
    if(!quality)continue;
    best[term]=Math.max(best[term],quality);
    hits.push({term,index,quality,start:words[index].start});
  }
  if(!hits.length)return null;
  const covered=best.map((quality,index)=>quality?index:-1).filter(index=>index>=0);
  const span=covered.length===query.terms.length?minimumSpan(hits,query.terms.length):Infinity;
  let phrase=false;
  if(query.phrase.length>1&&words.length>=query.phrase.length){
    outer:for(let start=0;start<=words.length-query.phrase.length;start++){
      for(let part=0;part<query.phrase.length;part++)if(!wordQuality(query.phrase[part],words[start+part].word))continue outer;
      phrase=true;break;
    }
  }
  const firstHit=hits.reduce((a,b)=>a.start<b.start?a:b);
  return {...field,best,covered,span,phrase,firstHit:firstHit.start};
}

function snippet(field){
  const text=field.text.replace(/\s+/g,' ').trim();
  if(text.length<=190)return text;
  const center=Math.min(field.firstHit,text.length-1);
  let start=Math.max(0,center-55),end=Math.min(text.length,start+190);
  if(end===text.length)start=Math.max(0,end-190);
  if(start>0){const next=text.indexOf(' ',start);if(next>0&&next-start<20)start=next+1;}
  if(end<text.length){const prev=text.lastIndexOf(' ',end);if(prev>end-20)end=prev;}
  return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}

function evidenceFor(matches,query){
  const remaining=new Set(query.terms.map((_,index)=>index)),chosen=[];
  while(remaining.size){
    const candidate=matches.filter(match=>!chosen.includes(match)).sort((a,b)=>{
      const score=match=>match.covered.filter(index=>remaining.has(index)).length*100+match.weight+(match.phrase?20:0)+(Number.isFinite(match.span)?10/match.span:0);
      return score(b)-score(a);
    })[0];
    if(!candidate||!candidate.covered.some(index=>remaining.has(index)))break;
    chosen.push(candidate);
    for(const index of candidate.covered)remaining.delete(index);
  }
  return chosen.map(match=>({field:match.field,label:match.label,snippet:snippet(match)}));
}

/** Return null when a video lacks any query term. Terms may occur in different fields. */
export function matchVideoSearch(video,input,metadataLookup){
  const query=typeof input==='string'?prepareSearchQuery(input):input;
  if(!video||typeof video!=='object'||!query?.terms?.length)return null;
  const matches=fieldsFor(video,metadataFor(video,metadataLookup)).map(field=>fieldMatch(field,query)).filter(Boolean);
  if(!matches.length)return null;
  const scoreByTerm=query.terms.map((_,index)=>Math.max(0,...matches.map(match=>match.best[index]*match.weight)));
  if(scoreByTerm.some(score=>!score))return null;
  let score=scoreByTerm.reduce((sum,value)=>sum+value,0);
  if(query.terms.length>1){
    score+=Math.max(0,...matches.map(match=>match.covered.length===query.terms.length
      ?match.weight*(match.phrase?2:Number.isFinite(match.span)?0.8+2/Math.max(2,match.span):0)
      :0));
  }
  return {score:Math.round(score*100)/100,evidence:evidenceFor(matches,query)};
}

/** Ranked matches, with the original order kept for equal scores. */
export function searchVideos(videos,input,metadataLookup){
  const query=typeof input==='string'?prepareSearchQuery(input):input;
  if(!query?.terms?.length)return [];
  return videos.map((video,index)=>({video,index,match:matchVideoSearch(video,query,metadataLookup)})).filter(row=>row.match).sort((a,b)=>b.match.score-a.match.score||a.index-b.index).map(({video,match})=>({video,...match}));
}
