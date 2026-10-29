import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tests=["verify.mjs", "verify-library.mjs", "verify-expanded-exclusions.mjs", "verify-continuations.mjs", "verify-exporter.mjs", "verify-incremental.mjs", "verify-studio.mjs", "audit-tests.mjs", "audit-storage.mjs", "test-content-search.mjs", "test-metadata-cache.mjs", "test-video-metadata.mjs", "test-long-watch.mjs", "test-automation.mjs", "test-playback-background.mjs", "test-playback-content.mjs", "test-speed.mjs", "test-speed-background.mjs", "test-sync.mjs", "test-sync-connect.mjs", "test-firefox.mjs", "test-firefox-background.mjs"];
for(const file of tests){const r=spawnSync(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});process.stdout.write(r.stdout);if(r.status!==0){process.stderr.write(r.stderr);process.exit(r.status||1)}}
console.log('PASS: all '+tests.length+' test programs');
