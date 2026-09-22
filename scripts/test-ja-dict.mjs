// Unit test for the Japanese dictionary: real shards from extension/dict/ja with stubbed chrome/fetch.
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
const ja = await import('../extension/background/ja-dict.js');
let fail = 0;
const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const info = await ja.dictionaryInfo();
check('index loads', info && info.entries > 200000 && info.kanji > 10000, JSON.stringify(info));

const r1 = await ja.scan('買いました。次の日');
check('買いました -> 買う (polite past), whole inflected form matched', r1 && r1.matched === '買いました' && r1.results[0].headword === '買う' && r1.results[0].reading === 'かう' && r1.results[0].trail.some((t) => t.includes('quá khứ lịch sự')), JSON.stringify(r1 && { matched: r1.matched, hw: r1.results[0]?.headword, trail: r1.results[0]?.trail }));
check('買う has Vietnamese gloss + English senses', r1 && /mua/.test(r1.results[0].vi) && r1.results[0].senses[0].gloss.includes('to buy') && /godan/.test(r1.results[0].senses[0].posLabel), r1 && `${r1.results[0].vi} | ${r1.results[0].senses[0].posLabel}`);

const r2 = await ja.scan('勉強しましたが');
check('勉強しました -> 勉強する via synthetic する key', r2 && r2.matched === '勉強しました' && r2.results[0].headword === '勉強する' && r2.results[0].reading === 'べんきょうする', JSON.stringify(r2 && { matched: r2.matched, hw: r2.results[0]?.headword }));

const r3 = await ja.scan('経済は依然として');
check('経済 (noun, longest match stops before は)', r3 && r3.matched === '経済' && r3.results[0].headword === '経済', JSON.stringify(r3 && { matched: r3.matched, hw: r3.results[0]?.headword, vi: r3.results[0]?.vi }));

const r4 = await ja.scan('新しい本を');
check('新しい (i-adjective) matched, not 新し', r4 && r4.matched === '新しい' && r4.results[0].headword === '新しい', JSON.stringify(r4 && { matched: r4.matched }));

const r5 = await ja.scan('食べられなかった');
check('食べられなかった -> 食べる with trail', r5 && r5.results.some((r) => r.headword === '食べる') && r5.matched === '食べられなかった', JSON.stringify(r5 && { matched: r5.matched, hws: r5.results.map((r) => r.headword) }));

check('single kana particle is skipped on hover', (await ja.scan('は昨日')) === null);
const r6 = await ja.scan('は', { allowSingleKana: true });
check('single kana allowed for selections', r6 && r6.results.length > 0, JSON.stringify(r6 && r6.results[0].senses[0]));

const r7 = await ja.scan('本を買う');
check('本 (single kanji word) found with kanji info attached', r7 && r7.matched === '本' && r7.results[0].headword === '本' && r7.kanji && r7.kanji.literal === '本', JSON.stringify(r7 && { matched: r7.matched, kanji: r7.kanji?.meanings?.slice(0, 2) }));

const k = await ja.kanjiInfo('買');
check('kanjidic 買: JLPT 4, grade 2, readings', k && k.jlpt === 4 && k.grade === 2 && k.on.includes('バイ') && k.meanings.includes('buy'), JSON.stringify(k));

const r8 = await ja.scan('コンピューターを');
check('katakana loanword', r8 && r8.matched.startsWith('コンピュータ') && r8.results.length > 0, JSON.stringify(r8 && { matched: r8.matched, hw: r8.results[0]?.headword }));

const r9 = await ja.scan('堅調です。');
check('堅調です -> 堅調 (copula absorbed, headword is the noun)', r9 && r9.matched === '堅調です' && r9.results[0].headword === '堅調' && r9.results[0].trail.length === 1, JSON.stringify(r9 && { matched: r9.matched, hw: r9.results[0]?.headword, trail: r9.results[0]?.trail }));

const r10 = await ja.scan('行った');
check('行った lists both 行く and 行う', r10 && r10.results.some((r) => r.headword === '行く') && r10.results.some((r) => r.headword === '行う'), JSON.stringify(r10 && r10.results.map((r) => r.headword)));

const t0 = performance.now(); await ja.scan('読んでいます'); const t1 = performance.now(); await ja.scan('読みました'); const t2 = performance.now();
check('scan timing (cold < 400 ms, warm < 20 ms)', t1 - t0 < 400 && t2 - t1 < 20, `cold ${(t1 - t0).toFixed(1)} ms, warm ${(t2 - t1).toFixed(2)} ms`);

console.log(`\n${fail ? 'FAILED' : 'OK'}`);
process.exit(fail ? 1 : 0);
