import { deinflect, T } from '../extension/background/ja-deinflect.js';

const cases = [
  ['買いました', '買う', T.V5], ['買った', '買う', T.V5], ['買って', '買う', T.V5], ['買わない', '買う', T.V5],
  ['買わなかった', '買う', T.V5], ['買わなければ', '買う', T.V5], ['買える', '買う', T.V5], ['買われた', '買う', T.V5],
  ['買わせられました', '買う', T.V5], ['買いたかった', '買う', T.V5], ['買おう', '買う', T.V5], ['買えば', '買う', T.V5],
  ['食べられました', '食べる', T.V1], ['食べない', '食べる', T.V1], ['食べたい', '食べる', T.V1], ['食べています', '食べる', T.V1],
  ['食べてみましょう', '食べる', T.V1], ['食べさせられた', '食べる', T.V1], ['食べよう', '食べる', T.V1],
  ['行った', '行く', T.V5], ['行った', '行う', T.V5], ['行きます', '行く', T.V5],
  ['勉強しました', '勉強する', T.VS], ['勉強できる', '勉強する', T.VS], ['勉強している', '勉強する', T.VS], ['勉強しなかった', '勉強する', T.VS],
  ['来ました', '来る', T.VK], ['来なかった', '来る', T.VK], ['きました', 'くる', T.VK],
  ['高くなかった', '高い', T.ADJI], ['高くて', '高い', T.ADJI], ['高ければ', '高い', T.ADJI], ['高さ', '高い', T.ADJI], ['高くなる', '高い', T.ADJI],
  ['読んでいます', '読む', T.V5], ['話してみましょう', '話す', T.V5], ['書かれている', '書く', T.V5], ['見せてください', '見せる', T.V1],
  ['走りながら', '走る', T.V5], ['泳ぎたくない', '泳ぐ', T.V5], ['待たせて', '待つ', T.V5], ['死んだ', '死ぬ', T.V5], ['遊んでいた', '遊ぶ', T.V5],
  ['静かだった', '静か', T.ALL], ['学生です', '学生', T.ALL], ['帰らなくて', '帰る', T.V5],
];
let fail = 0;
for (const [input, expected, types] of cases) {
  const cands = deinflect(input);
  const hit = cands.find((c) => c.text === expected && (types === T.ALL ? true : (c.types & types)));
  if (!hit) { fail++; console.log(`FAIL ${input} -> expected ${expected}; got ${cands.slice(0, 12).map((c) => c.text).join(', ')}`); }
}
const unchanged = deinflect('経済');
if (unchanged[0].text !== '経済' || unchanged[0].trail.length) { fail++; console.log('FAIL identity candidate'); }
const big = deinflect('食べさせられていませんでした');
console.log('candidates for 食べさせられていませんでした:', big.length, big.filter((c) => c.text === '食べる').map((c) => c.trail.join(' > '))[0]);
console.log(`${cases.length + 1 - fail}/${cases.length + 1} passed`);
process.exit(fail ? 1 : 0);
