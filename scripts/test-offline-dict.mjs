// Unit test for the offline dictionary module: loads real shards from extension/dict/en-vi
// with stubbed chrome.runtime / fetch, then checks parsing and lookups.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, '..', 'extension');
globalThis.chrome = { runtime: { getURL: (p) => 'ext://' + p } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('ext://')) return realFetch(url, init);
  const file = path.join(EXT, u.slice(6));
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(file), { status: 200 });
};

const dict = await import('../extension/background/offline-dict.js');
let fail = 0;
const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const info = await dict.dictionaryInfo();
check('index loads', info && info.words > 100000 && info.phrases > 100000, JSON.stringify(info));

const sustain = await dict.lookupWord('sustain');
check('sustain: found with IPA', sustain && sustain.entry.ipa === "/səs'tein/", sustain?.entry.ipa);
check('sustain: first group is a verb with senses', sustain?.entry.groups[0]?.pos === 'ngoại động từ' && sustain.entry.groups[0].senses[0].vi === 'chống đỡ');
check('sustain: example attached to a sense', sustain?.entry.groups[0]?.senses.some((s) => s.examples.some((e) => e.en === 'enough to sustain life' && e.vi === 'đủ sống')));
const sum = dict.summarize(sustain.entry);
check('sustain: summary line', sum.lines[0]?.label === 'ngoại đt' && sum.lines[0].text.startsWith('chống đỡ; giữ vững được'), JSON.stringify(sum.lines[0]));

const tariffs = await dict.lookupWord('Tariffs');
check('tariffs -> tariff via lemma', tariffs?.headword === 'tariff' && tariffs.viaLemma === true);
const sustained = await dict.lookupWord('sustained');
check('sustained: own entry (adjective)', sustained && !sustained.viaLemma && /tính từ/.test(sustained.entry.groups[0]?.pos));

const resilient = await dict.lookupWord('resilient');
const rs = dict.summarize(resilient.entry);
check('resilient: adjective senses + field section', rs.lines[0]?.label === 'tính từ' && /đàn hồi/.test(rs.lines[0].text) && rs.lines.some((l) => l.field && /kỹ thuật/.test(l.label)), JSON.stringify(rs.lines));

const takeOff = await dict.lookupPhrase('took off');
check('phrase "took off" -> "take off"', takeOff?.headword === 'take off' && takeOff.viaLemma, takeOff?.headword);
const giveUp = await dict.lookupPhrase('give up');
const gs = giveUp ? dict.summarize(giveUp.entry) : null;
check('phrase with only field senses still summarised', gs && gs.lines.length === 1 && gs.lines[0].field && /kinh tế/.test(gs.lines[0].label) && gs.lines[0].text === 'khai báo', JSON.stringify(gs?.lines));

const edge = await dict.lookupWord('edge');
const es = dict.summarize(edge.entry);
check('idioms parsed', edge.entry.idioms.length >= 2 && es.idiom && /on edge/.test(es.idiom.phrase), JSON.stringify(es.idiom));
check('unknown word -> null', (await dict.lookupWord('zzzzqqqx')) === null);
check('4-word phrase -> null (not indexed)', (await dict.lookupPhrase('one two three four')) === null);
check('prefix mapping matches the build script', dict.prefixOf('él') === '_l' && dict.prefixOf('a') === 'a_' && dict.prefixOf("o'clock") === 'o_');
const merged = await dict.lookupWord('amid');
check('headword line with variant keeps first IPA', merged?.entry.ipa === "/ə'mid/", merged?.entry.ipa);

// timing: first lookup loads a shard, second is memory
const t0 = performance.now(); await dict.lookupWord('government'); const t1 = performance.now(); await dict.lookupWord('governor'); const t2 = performance.now();
check('lookup timing (cold shard < 300 ms, warm < 5 ms)', t1 - t0 < 300 && t2 - t1 < 5, `cold ${(t1 - t0).toFixed(1)} ms, warm ${(t2 - t1).toFixed(2)} ms`);

console.log(`\n${fail ? 'FAILED' : 'OK'}`);
process.exit(fail ? 1 : 0);
