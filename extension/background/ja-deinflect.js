// Japanese deinflection (Yomichan-style). Turns an inflected form found in text into
// candidate dictionary forms, e.g. 買いました -> 買う, 食べられなかった -> 食べる.
// Each candidate carries the grammatical types it must have (checked against JMdict POS tags)
// and the list of reasons applied, shown in the popup ("polite past").

export const T = { V1: 1, V5: 2, VS: 4, VK: 8, ADJI: 16, ALL: 0xffff };

const GODAN = [
  //  u     i     a     e     o     ta     te
  ['う', 'い', 'わ', 'え', 'お', 'った', 'って'],
  ['く', 'き', 'か', 'け', 'こ', 'いた', 'いて'],
  ['ぐ', 'ぎ', 'が', 'げ', 'ご', 'いだ', 'いで'],
  ['す', 'し', 'さ', 'せ', 'そ', 'した', 'して'],
  ['つ', 'ち', 'た', 'て', 'と', 'った', 'って'],
  ['ぬ', 'に', 'な', 'ね', 'の', 'んだ', 'んで'],
  ['ぶ', 'び', 'ば', 'べ', 'ぼ', 'んだ', 'んで'],
  ['む', 'み', 'ま', 'め', 'も', 'んだ', 'んで'],
  ['る', 'り', 'ら', 'れ', 'ろ', 'った', 'って'],
];

// [reason, kanaIn, kanaOut, rulesIn (0 = any), rulesOut]
const RULES = [];
const add = (reason, kanaIn, kanaOut, rulesIn, rulesOut) => RULES.push({ reason, kanaIn, kanaOut, rulesIn, rulesOut });

for (const [u, i, a, e, o, ta, te] of GODAN) {
  add('lịch sự (ます)', i + 'ます', u, 0, T.V5);
  add('quá khứ lịch sự (ました)', i + 'ました', u, 0, T.V5);
  add('phủ định lịch sự (ません)', i + 'ません', u, 0, T.V5);
  add('quá khứ phủ định lịch sự', i + 'ませんでした', u, 0, T.V5);
  add('ý chí lịch sự (ましょう)', i + 'ましょう', u, 0, T.V5);
  add('mệnh lệnh lịch sự (なさい)', i + 'なさい', u, 0, T.V5);
  add('vừa... vừa (ながら)', i + 'ながら', u, 0, T.V5);
  add('có vẻ (そう)', i + 'そう', u, 0, T.V5);
  add('quá (すぎる)', i + 'すぎる', u, 0, T.V5);
  add('muốn (たい)', i + 'たい', u, T.ADJI, T.V5);
  add('thể ます (gốc)', i, u, 0, T.V5);
  add('quá khứ (た)', ta, u, 0, T.V5);
  add('điều kiện (たら)', ta + 'ら', u, 0, T.V5);
  add('liệt kê (たり)', ta + 'り', u, 0, T.V5);
  add('thể て', te, u, 0, T.V5);
  add('phủ định (ない)', a + 'ない', u, T.ADJI, T.V5);
  add('phủ định (ず)', a + 'ず', u, 0, T.V5);
  add('ý chí (う)', o + 'う', u, 0, T.V5);
  add('khả năng', e + 'る', u, T.V1, T.V5);
  add('bị động', a + 'れる', u, T.V1, T.V5);
  add('sai khiến', a + 'せる', u, T.V1, T.V5);
  if (u !== 'す') add('sai khiến bị động', a + 'される', u, T.V1, T.V5);
  add('điều kiện (ば)', e + 'ば', u, 0, T.V5);
  add('mệnh lệnh', e, u, 0, T.V5);
}
// 行く: 行った / 行って
add('quá khứ (た)', '行った', '行く', 0, T.V5);
add('thể て', '行って', '行く', 0, T.V5);
add('quá khứ (た)', 'いった', 'いく', 0, T.V5);
add('thể て', 'いって', 'いく', 0, T.V5);

// ichidan
add('lịch sự (ます)', 'ます', 'る', 0, T.V1);
add('quá khứ lịch sự (ました)', 'ました', 'る', 0, T.V1);
add('phủ định lịch sự (ません)', 'ません', 'る', 0, T.V1);
add('quá khứ phủ định lịch sự', 'ませんでした', 'る', 0, T.V1);
add('ý chí lịch sự (ましょう)', 'ましょう', 'る', 0, T.V1);
add('mệnh lệnh lịch sự (なさい)', 'なさい', 'る', 0, T.V1);
add('vừa... vừa (ながら)', 'ながら', 'る', 0, T.V1);
add('có vẻ (そう)', 'そう', 'る', 0, T.V1);
add('quá (すぎる)', 'すぎる', 'る', 0, T.V1);
add('muốn (たい)', 'たい', 'る', T.ADJI, T.V1);
add('quá khứ (た)', 'た', 'る', 0, T.V1);
add('điều kiện (たら)', 'たら', 'る', 0, T.V1);
add('liệt kê (たり)', 'たり', 'る', 0, T.V1);
add('thể て', 'て', 'る', 0, T.V1);
add('phủ định (ない)', 'ない', 'る', T.ADJI, T.V1);
add('phủ định (ず)', 'ず', 'る', 0, T.V1);
add('ý chí (よう)', 'よう', 'る', 0, T.V1);
add('khả năng / bị động', 'られる', 'る', T.V1, T.V1);
add('sai khiến', 'させる', 'る', T.V1, T.V1);
add('điều kiện (ば)', 'れば', 'る', 0, T.V1);
add('mệnh lệnh', 'ろ', 'る', 0, T.V1);
add('mệnh lệnh', 'よ', 'る', 0, T.V1);

// suru
for (const [pre, base] of [['し', 'する']]) {
  add('lịch sự (ます)', pre + 'ます', base, 0, T.VS);
  add('quá khứ lịch sự (ました)', pre + 'ました', base, 0, T.VS);
  add('phủ định lịch sự (ません)', pre + 'ません', base, 0, T.VS);
  add('quá khứ phủ định lịch sự', pre + 'ませんでした', base, 0, T.VS);
  add('ý chí lịch sự (ましょう)', pre + 'ましょう', base, 0, T.VS);
  add('quá khứ (た)', pre + 'た', base, 0, T.VS);
  add('điều kiện (たら)', pre + 'たら', base, 0, T.VS);
  add('thể て', pre + 'て', base, 0, T.VS);
  add('phủ định (ない)', pre + 'ない', base, T.ADJI, T.VS);
  add('ý chí (よう)', pre + 'よう', base, 0, T.VS);
  add('muốn (たい)', pre + 'たい', base, T.ADJI, T.VS);
  add('vừa... vừa (ながら)', pre + 'ながら', base, 0, T.VS);
  add('quá (すぎる)', pre + 'すぎる', base, 0, T.VS);
  add('mệnh lệnh', pre + 'ろ', base, 0, T.VS);
}
add('bị động', 'される', 'する', T.V1, T.VS);
add('sai khiến', 'させる', 'する', T.V1, T.VS);
add('khả năng (できる)', 'できる', 'する', T.V1, T.VS);
add('điều kiện (ば)', 'すれば', 'する', 0, T.VS);
add('mệnh lệnh', 'せよ', 'する', 0, T.VS);
add('phủ định (ず)', 'せず', 'する', 0, T.VS);

// kuru
for (const [stem, base] of [['来', '来る'], ['き', 'くる'], ['来', 'くる']]) {
  const k = stem === '来' ? '来' : 'き';
  add('lịch sự (ます)', k + 'ます', base, 0, T.VK);
  add('quá khứ lịch sự (ました)', k + 'ました', base, 0, T.VK);
  add('phủ định lịch sự (ません)', k + 'ません', base, 0, T.VK);
  add('quá khứ (た)', k + 'た', base, 0, T.VK);
  add('thể て', k + 'て', base, 0, T.VK);
  add('muốn (たい)', k + 'たい', base, T.ADJI, T.VK);
  const ko = stem === '来' ? '来' : 'こ';
  add('phủ định (ない)', ko + 'ない', base, T.ADJI, T.VK);
  add('ý chí (よう)', ko + 'よう', base, 0, T.VK);
  add('khả năng / bị động', ko + 'られる', base, T.V1, T.VK);
  add('sai khiến', ko + 'させる', base, T.V1, T.VK);
  add('mệnh lệnh', ko + 'い', base, 0, T.VK);
  const ku = stem === '来' ? '来' : 'く';
  add('điều kiện (ば)', ku + 'れば', base, 0, T.VK);
}

// i-adjectives
add('phủ định (くない)', 'くない', 'い', 0, T.ADJI);
add('quá khứ (かった)', 'かった', 'い', 0, T.ADJI);
add('quá khứ phủ định', 'くなかった', 'い', 0, T.ADJI);
add('thể て (くて)', 'くて', 'い', 0, T.ADJI);
add('trạng từ (く)', 'く', 'い', 0, T.ADJI);
add('trở nên (くなる)', 'くなる', 'い', 0, T.ADJI);
add('điều kiện (ければ)', 'ければ', 'い', 0, T.ADJI);
add('điều kiện (かったら)', 'かったら', 'い', 0, T.ADJI);
add('quá (すぎる)', 'すぎる', 'い', 0, T.ADJI);
add('có vẻ (そう)', 'そう', 'い', 0, T.ADJI);
add('danh từ hoá (さ)', 'さ', 'い', 0, T.ADJI);
add('lịch sự (です)', 'いです', 'い', 0, T.ADJI);
add('quá khứ lịch sự', 'かったです', 'い', 0, T.ADJI);

// auxiliaries after the te-form (chain into the te-form rules above)
for (const te of ['て', 'で']) {
  for (const [aux, reason] of [
    ['いる', 'đang (ている)'], ['る', 'đang (てる)'], ['いた', 'đã đang (ていた)'], ['た', 'đã đang (てた)'],
    ['います', 'đang, lịch sự'], ['ます', 'đang, lịch sự'], ['いました', 'đã đang, lịch sự'], ['ました', 'đã đang, lịch sự'],
    ['いない', 'không đang (ていない)'], ['ない', 'không đang (てない)'], ['いません', 'không đang, lịch sự'],
    ['ある', 'trạng thái (てある)'], ['おく', 'chuẩn bị (ておく)'], ['みる', 'thử (てみる)'], ['しまう', 'lỡ / xong (てしまう)'],
    ['くる', 'đến (てくる)'], ['いく', 'đi (ていく)'], ['くれる', 'cho tôi (てくれる)'], ['もらう', 'được... cho (てもらう)'],
    ['あげる', 'làm cho (てあげる)'], ['いただく', 'được... cho, kính ngữ'], ['ください', 'xin hãy (てください)'],
    ['くださる', 'kính ngữ (てくださる)'], ['ほしい', 'muốn ai đó (てほしい)'], ['は', 'てはいけない...'], ['も', 'dù (ても)'],
  ]) add(reason, te + aux, te, 0, T.ALL);
}

// copula / na-adjective endings (result may be a noun or na-adjective)
for (const [k, reason] of [['です', 'lịch sự (です)'], ['でした', 'quá khứ lịch sự (でした)'], ['だった', 'quá khứ (だった)'], ['だ', 'khẳng định (だ)'],
  ['じゃない', 'phủ định (じゃない)'], ['ではない', 'phủ định (ではない)'], ['じゃなかった', 'quá khứ phủ định'], ['ではなかった', 'quá khứ phủ định'],
  ['ではありません', 'phủ định lịch sự'], ['じゃありません', 'phủ định lịch sự'], ['なら', 'nếu (なら)'], ['なので', 'vì (なので)'], ['でしょう', 'có lẽ (でしょう)'],
  ['だろう', 'có lẽ (だろう)']]) add(reason, k, '', 0, T.ALL);

// sort longest suffix first so the most specific rule is tried first
RULES.sort((a, b) => b.kanaIn.length - a.kanaIn.length);

const MAX_DEPTH = 5;
const MAX_CANDIDATES = 300;

// Returns [{ text, types, trail }], first entry is the unmodified text.
export function deinflect(text) {
  const results = [{ text, types: T.ALL, trail: [] }];
  const seen = new Set([text + '|' + T.ALL]);
  for (let i = 0; i < results.length && results.length < MAX_CANDIDATES; i++) {
    const cur = results[i];
    if (cur.trail.length >= MAX_DEPTH) continue;
    for (const rule of RULES) {
      if (rule.rulesIn && !(cur.types & rule.rulesIn)) continue;
      if (!cur.text.endsWith(rule.kanaIn)) continue;
      const next = cur.text.slice(0, cur.text.length - rule.kanaIn.length) + rule.kanaOut;
      if (!next || next === cur.text) continue;
      if (cur.text.length - rule.kanaIn.length === 0 && rule.kanaOut.length <= 1) continue; // whole word was the suffix
      const key = next + '|' + rule.rulesOut;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ text: next, types: rule.rulesOut, trail: [...cur.trail, rule.reason] });
    }
  }
  return results;
}

// JMdict part-of-speech tags -> grammatical type bitmask used for validation.
export function posToTypes(tags) {
  let t = 0;
  for (const tag of tags || []) {
    if (tag === 'v1' || tag === 'v1-s') t |= T.V1;
    else if (tag.startsWith('v5') || tag === 'v4r' || tag === 'v4k') t |= T.V5;
    else if (tag === 'vs' || tag === 'vs-i' || tag === 'vs-s' || tag === 'vs-c') t |= T.VS;
    else if (tag === 'vk') t |= T.VK;
    else if (tag === 'adj-i' || tag === 'adj-ix') t |= T.ADJI;
  }
  return t;
}

// A candidate produced by rules is valid for an entry only if the entry's verb/adjective type fits.
export function candidateFits(candidate, entryTypes) {
  if (!candidate.trail.length) return true;
  if (candidate.types === T.ALL) return true;
  return (candidate.types & entryTypes) !== 0;
}
