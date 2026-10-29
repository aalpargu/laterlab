import assert from 'node:assert/strict';
import {choosePlaybackSpeed} from '../firefox-extension/src/speed.mjs';

const speed=(channelName,audioLanguage,captionTracks=[])=>choosePlaybackSpeed({channelName,audioLanguage,captionTracks});

// English audio takes precedence even when a channel has a custom rule.
assert.equal(speed('Bora Özkent','en'),1);
assert.equal(speed('Kanal Finans','en-US'),1);
assert.equal(speed('Yatırım 101','EN-gb'),1);
assert.equal(speed('Başka Kanal',undefined,[{kind:'asr',languageCode:'en'}]),1);
assert.equal(speed('Bora Özkent',undefined,[{kind:'asr',languageCode:'en-US'}]),1);
assert.equal(speed('Yatırım 101',undefined,[{kind:'asr',languageCode:'en-US'},{kind:'asr',languageCode:'tr'}]),1.5,'an English dub caption listed first does not make Turkish original audio English');
assert.equal(speed('Başka Kanal',undefined,[{kind:'asr',languageCode:'en-US'},{kind:'asr',languageCode:'en-GB'}]),1,'regional variants of English ASR still identify English audio');
assert.equal(speed('Başka Kanal','tr',[{kind:'asr',languageCode:'en'}]),1.5,'explicit audio language takes priority over captions');

// Manual/translated subtitles alone do not establish the spoken language.
assert.equal(speed('Bora Özkent',undefined,[{languageCode:'en'}]),1.25);
assert.equal(speed('Başka Kanal',undefined,[{languageCode:'en'}]),1.5);
assert.equal(speed('Başka Kanal',undefined,[{languageCode:'en'},{kind:'asr',languageCode:'tr'}]),1.5);

// Channel rules and the general non-English/unknown-language default.
assert.equal(speed('Bora Özkent','tr'),1.25);
assert.equal(speed('  BORA  ÖZKENT  ','tr'),1.25);
assert.equal(speed('Kanal Finans','tr'),1.5);
assert.equal(speed('Yatırım 101','tr'),1.5);
assert.equal(speed('Başka Kanal','tr'),1.5);
assert.equal(speed('Başka Kanal',undefined),1.5);
assert.equal(speed('Bora Özkent',undefined),1.25);
assert.equal(speed('Bora Özkent Klipleri','tr'),1.5,'a similarly named channel must not inherit the special speed');

console.log('PASS speed rules: channel defaults, English audio override, automatic caption signal and safe unknown-language fallback.');
