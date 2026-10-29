// No Static Assets binding: Cloudflare Access passes ctx.access to this Worker.
// The built worker embeds the small application bundle from public/.
const allowedEmails=new Set(['alpargu37@gmail.com']);
const mime={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8',svg:'image/svg+xml'};
function reply(body,status=200,headers={}){return new Response(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...headers}});}
export default {
 async fetch(request,env,ctx){
  if(!ctx.access)return reply('Sıradaki için Cloudflare Access girişi gereklidir. Erişim yapılandırması tamamlanana kadar site kapalıdır.',403,{'Content-Type':'text/plain; charset=utf-8'});
  let identity;try{identity=await ctx.access.getIdentity();}catch{return reply('Oturum doğrulanamadı.',403);}
  if(!allowedEmails.has(String(identity?.email||'').trim().toLowerCase()))return reply('Bu e-posta adresinin Sıradaki erişimi yok.',403);
  if(!['GET','HEAD'].includes(request.method))return reply('Method not allowed',405,{'Allow':'GET, HEAD'});
  const pathname=new URL(request.url).pathname;
  if(pathname==='/api/session')return reply(request.method==='HEAD'?null:JSON.stringify({email:identity.email}),200,{'Content-Type':'application/json'});
  const name=pathname==='/'?'/index.html':pathname;
  if(!Object.hasOwn(files,name))return reply('Not found',404);
  return reply(request.method==='HEAD'?null:files[name],200,{'Content-Type':mime[name.split('.').pop()]||'application/octet-stream'});
 }
};
