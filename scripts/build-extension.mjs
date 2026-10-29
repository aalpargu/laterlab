import {build} from 'esbuild';
for(const name of ['background','youtube','playback']) await build({entryPoints:['firefox-extension/src/'+name+'.mjs'],outfile:'firefox-extension/'+name+'.js',bundle:true,format:'iife',platform:'browser',target:'firefox140',minify:false,legalComments:'inline'});
