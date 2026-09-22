// Seed the LOCAL backend with a demo account and realistic words (AI content already filled in).
//   node scripts/seed-local.mjs [http://127.0.0.1:8787] [--reset]
// Creates (or logs in) demo@readlex.local / demo12345. --reset deletes that account first, so the
// demo starts again from a known state (review history is only seeded into an account without reviews).
const RESET = process.argv.includes('--reset');
const API = process.argv.slice(2).find((a) => a.startsWith('http')) || 'http://127.0.0.1:8787';
const EMAIL = 'demo@readlex.local';
const PASSWORD = 'demo12345';
let TOKEN = '';
if (RESET) {
  const login = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then((r) => r.json());
  if (login.ok) { await fetch(`${API}/api/v1/me`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ password: PASSWORD }) }); console.log('demo account reset'); }
}
{
  const reg = await fetch(`${API}/api/v1/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, inviteCode: 'letmein', displayName: 'Demo' }) }).then((r) => r.json());
  if (reg.ok) TOKEN = reg.token;
  else {
    const login = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then((r) => r.json());
    if (!login.ok) { console.error('cannot register/login demo user:', reg.error, login.error); process.exit(1); }
    TOKEN = login.token;
  }
  // Only give the demo account a fake key when the server is faking Gemini too; against a real
  // Gemini a bogus key would just burn enrichment attempts and show "API key not valid".
  const health = await fetch(`${API}/api/v1/health`).then((r) => r.json()).catch(() => ({}));
  if (health.mock) await fetch(`${API}/api/v1/me/gemini`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ apiKey: 'AIza-demo-key', model: 'gemini-2.5-flash' }) });
  else { await fetch(`${API}/api/v1/me/gemini`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } }); console.log('server talks to the real Gemini: add your own key in Settings for this account'); }
  console.log(`demo account: ${EMAIL} / ${PASSWORD}`);
}
const day = 86400000;
const now = Date.now();
const en = (lemma, surface, sentence, url, title, e, daysAgo = 0) => ({
  vocabulary: { id: 'seed-' + lemma, language: 'en', lemma, surface, quickMeaning: e.meaningVi.split(';')[0], ipa: e.ipa, createdAt: now - daysAgo * day, enrichment: { reading: '', level: '', definitionEn: '', synonyms: [], wordFamily: [], notes: '', learningPriority: 4, isProperNoun: false, sentenceVi: '', ...e } },
  exposure: { surface, sentence, paragraph: sentence, url, pageTitle: title, encounteredAt: now - daysAgo * day },
});
const ja = (lemma, surface, reading, sentence, url, title, e, daysAgo = 0) => ({
  vocabulary: { id: 'seed-' + lemma, language: 'ja', lemma, surface, reading, quickMeaning: e.meaningVi.split(';')[0], createdAt: now - daysAgo * day, enrichment: { ipa: '', cefr: '', definitionEn: '', synonyms: [], wordFamily: [], notes: '', learningPriority: 4, isProperNoun: false, sentenceVi: '', reading, ...e } },
  exposure: { surface, sentence, paragraph: sentence, url, pageTitle: title, encounteredAt: now - daysAgo * day },
});
const items = [
  en('sustain', 'sustain', 'The company struggled to sustain growth in the third quarter.', 'https://www.reuters.com/markets/', 'US economy faces new tariffs - Reuters',
    { lemma: 'sustain', partOfSpeech: 'verb', ipa: '/səˈsteɪn/', meaningVi: 'duy trì; giữ vững; chịu đựng', meaningInContext: 'duy trì (tốc độ tăng trưởng)', sentenceVi: 'Công ty chật vật duy trì tăng trưởng trong quý ba.', definitionEn: 'to make something continue for a period of time', cefr: 'B2', collocations: ['sustain growth', 'sustain interest', 'sustain damage', 'sustain a loss'], example: 'High demand helped the firm sustain record profits.', exampleVi: 'Nhu cầu cao giúp công ty duy trì lợi nhuận kỷ lục.', synonyms: ['maintain', 'keep up'], wordFamily: ['sustainable', 'sustainability'], notes: 'Trang trọng hơn "keep". "Sustain damage/injuries" nghĩa là chịu thiệt hại, không phải duy trì.', learningPriority: 5 }, 1),
  en('resilient', 'resilient', 'The economy remains resilient even as the government imposed sweeping tariffs.', 'https://www.bbc.com/news/business', 'Economy remains resilient - BBC',
    { lemma: 'resilient', partOfSpeech: 'adjective', ipa: '/rɪˈzɪliənt/', meaningVi: 'kiên cường; có khả năng phục hồi nhanh', meaningInContext: 'vững vàng, chống chịu tốt (nền kinh tế)', sentenceVi: 'Nền kinh tế vẫn vững vàng dù chính phủ áp thuế quan trên diện rộng.', definitionEn: 'able to recover quickly from difficulties', cefr: 'B2', collocations: ['resilient economy', 'remain resilient', 'resilient to shocks'], example: 'Children are often more resilient than adults expect.', exampleVi: 'Trẻ em thường kiên cường hơn người lớn nghĩ.', synonyms: ['robust', 'tough'], wordFamily: ['resilience'], notes: 'Rất hay gặp trong tin kinh tế: "resilient consumer spending".', learningPriority: 5 }, 0),
  en('curb', 'curb', 'Officials said the measures were needed to curb inflation.', 'https://www.bloomberg.com/', 'Fed moves to curb inflation - Bloomberg',
    { lemma: 'curb', partOfSpeech: 'verb', ipa: '/kɜːrb/', meaningVi: 'kiềm chế; hạn chế', meaningInContext: 'kiềm chế (lạm phát)', sentenceVi: 'Giới chức nói các biện pháp là cần thiết để kiềm chế lạm phát.', definitionEn: 'to control or limit something harmful', cefr: 'C1', collocations: ['curb inflation', 'curb spending', 'curb emissions'], example: 'The city introduced tolls to curb traffic downtown.', exampleVi: 'Thành phố thu phí để hạn chế xe vào trung tâm.', synonyms: ['restrain', 'rein in'], wordFamily: [], notes: 'Danh từ "curb" còn là lề đường (Mỹ).', learningPriority: 4 }, 2),
  en('amid', 'amid', 'Stocks fell amid fears of a wider conflict.', 'https://www.ft.com/', 'Markets - FT',
    { lemma: 'amid', partOfSpeech: 'preposition', ipa: '/əˈmɪd/', meaningVi: 'giữa lúc; trong bối cảnh', meaningInContext: 'giữa lúc (lo ngại xung đột lan rộng)', sentenceVi: 'Cổ phiếu giảm giữa lúc lo ngại xung đột lan rộng.', definitionEn: 'in the middle of or during something', cefr: 'B2', collocations: ['amid fears', 'amid concerns', 'amid growing pressure'], example: 'The talks collapsed amid mutual accusations.', exampleVi: 'Cuộc đàm phán đổ vỡ giữa những cáo buộc lẫn nhau.', synonyms: ['amidst', 'during'], wordFamily: [], notes: 'Từ đặc trưng của tít báo, ít dùng khi nói.', learningPriority: 5 }, 2),
  en('geopolitical', 'geopolitical', 'Geopolitical tensions weighed on exports.', 'https://www.reuters.com/world/', 'Exports slow - Reuters',
    { lemma: 'geopolitical', partOfSpeech: 'adjective', ipa: '/ˌdʒiːəʊpəˈlɪtɪkl/', meaningVi: 'thuộc về địa chính trị', meaningInContext: 'căng thẳng địa chính trị', sentenceVi: 'Căng thẳng địa chính trị đè nặng lên xuất khẩu.', definitionEn: 'relating to politics influenced by geography', cefr: 'C1', collocations: ['geopolitical tensions', 'geopolitical risk'], example: 'Oil prices react quickly to geopolitical risk.', exampleVi: 'Giá dầu phản ứng nhanh với rủi ro địa chính trị.', synonyms: [], wordFamily: ['geopolitics'], notes: '', learningPriority: 3 }, 3),
  en('shrug off', 'shrugged off', 'Investors shrugged off the news, and stocks edged higher.', 'https://www.wsj.com/', 'Markets - WSJ',
    { lemma: 'shrug off', partOfSpeech: 'phrasal verb', ipa: '/ʃrʌɡ ɒf/', meaningVi: 'bỏ qua, không bận tâm', meaningInContext: 'phớt lờ (tin xấu)', sentenceVi: 'Nhà đầu tư phớt lờ tin này và cổ phiếu nhích lên.', definitionEn: 'to treat something as unimportant', cefr: 'C1', collocations: ['shrug off criticism', 'shrug off concerns'], example: 'She shrugged off the injury and finished the race.', exampleVi: 'Cô ấy bỏ qua chấn thương và hoàn thành cuộc đua.', synonyms: ['dismiss', 'ignore'], wordFamily: ['shrug'], notes: 'Nghĩa đen là nhún vai.', learningPriority: 4 }, 3),
  en('edge higher', 'edged higher', 'Investors shrugged off the news, and stocks edged higher.', 'https://www.wsj.com/', 'Markets - WSJ',
    { lemma: 'edge higher', partOfSpeech: 'phrasal verb', ipa: '', meaningVi: 'nhích lên, tăng nhẹ', meaningInContext: 'cổ phiếu nhích lên', sentenceVi: 'Nhà đầu tư phớt lờ tin này và cổ phiếu nhích lên.', definitionEn: 'to rise slightly', cefr: 'C1', collocations: ['edge higher', 'edge lower', 'edge up'], example: 'The yen edged higher against the dollar.', exampleVi: 'Đồng yên nhích lên so với đô la.', synonyms: ['inch up'], wordFamily: [], notes: 'Ngôn ngữ tin tài chính; ngược lại là edge lower.', learningPriority: 3 }, 0),
  en('undersecretary', 'undersecretary', 'The undersecretary told reporters on Tuesday that talks would continue.', 'https://apnews.com/', 'Talks continue - AP',
    { lemma: 'undersecretary', partOfSpeech: 'noun', ipa: '/ˌʌndəˈsekrətəri/', meaningVi: 'thứ trưởng', meaningInContext: 'thứ trưởng', sentenceVi: 'Thứ trưởng nói với phóng viên hôm thứ Ba rằng đàm phán sẽ tiếp tục.', definitionEn: 'a senior official ranking below a secretary', cefr: 'C2', collocations: ['undersecretary of state'], example: 'The undersecretary for trade visited Hanoi last week.', exampleVi: 'Thứ trưởng phụ trách thương mại thăm Hà Nội tuần trước.', synonyms: [], wordFamily: ['secretary'], notes: 'Chức danh, ít cần học chủ động.', learningPriority: 2 }, 5),
  ja('買う', '買いました', 'かう', '私は昨日新しい本を買いました。', 'https://www3.nhk.or.jp/news/', 'NHK NEWS WEB',
    { lemma: '買う', partOfSpeech: 'động từ nhóm 1', meaningVi: 'mua', meaningInContext: 'mua (sách)', sentenceVi: 'Hôm qua tôi đã mua một cuốn sách mới.', definitionEn: 'to buy', level: 'N5', collocations: ['本を買う', '切符を買う', '買い物をする'], example: '駅で新聞を買った。', exampleVi: 'Tôi đã mua báo ở ga.', synonyms: ['購入する'], wordFamily: ['買い物', '売買'], notes: 'Hán Việt: 買 = MÃI. 買いました là thể quá khứ lịch sự.', learningPriority: 5 }, 1),
  ja('維持', '維持する', 'いじ', '経済成長を維持する必要がある。', 'https://www.nikkei.com/', '日本経済新聞',
    { lemma: '維持', partOfSpeech: 'danh từ + する', meaningVi: 'duy trì', meaningInContext: 'duy trì (tăng trưởng kinh tế)', sentenceVi: 'Cần duy trì tăng trưởng kinh tế.', definitionEn: 'maintenance', level: 'N2', collocations: ['現状を維持する', '健康を維持する'], example: '健康を維持するために毎日歩く。', exampleVi: 'Tôi đi bộ mỗi ngày để giữ sức khỏe.', synonyms: ['保つ'], wordFamily: ['維持費'], notes: 'Hán Việt: 維持 = DUY TRÌ, gần như trùng nghĩa tiếng Việt.', learningPriority: 4 }, 2),
  ja('堅調', '堅調', 'けんちょう', '経済は依然として堅調です。', 'https://www.nikkei.com/', '日本経済新聞',
    { lemma: '堅調', partOfSpeech: 'tính từ な', meaningVi: 'vững chắc, ổn định (thị trường)', meaningInContext: 'vẫn vững (nền kinh tế)', sentenceVi: 'Nền kinh tế vẫn vững chắc.', definitionEn: 'firm, steady (market)', level: 'N1', collocations: ['堅調な成長', '堅調に推移する'], example: '株価は堅調に推移している。', exampleVi: 'Giá cổ phiếu diễn biến ổn định.', synonyms: ['安定'], wordFamily: ['堅い', '調子'], notes: 'Hán Việt: 堅調 = KIÊN ĐIỀU. Từ báo chí kinh tế.', learningPriority: 3 }, 0),
];
const res = await fetch(`${API}/api/v1/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ app: 'readlex', version: 1, vocabulary: items.map((i) => i.vocabulary), exposures: items.map((i) => ({ ...i.exposure, vocabularyId: i.vocabulary.id })), lookups: [{ lemma: 'fiscal', count: 5, firstSeenAt: now - 10 * day, lastSeenAt: now - day, surfaces: ['fiscal'], sites: ['reuters.com', 'ft.com'] }] }) });
console.log(await res.text());
// A believable review history (only for a fresh account): some words are in long-term review, some are
// still being learned, two keep slipping ("Needs attention"), and three of today's-style words stay new.
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const stats = await fetch(`${API}/api/v1/stats`, { headers }).then((r) => r.json());
if (stats.totals.reviews === 0) {
  const today = await fetch(`${API}/api/v1/today?limitNew=50`, { headers }).then((r) => r.json());
  const byLemma = Object.fromEntries(today.new.map((c) => [c.lemma, c.cardId]));
  // [word, [[days ago, rating], ...]]  rating: 1 Again, 2 Hard, 3 Good, 4 Easy
  const history = [
    ['amid', [[20, 3], [19, 3], [16, 1], [16, 3], [12, 1], [11, 3], [6, 1], [5, 3], [2, 3]]],
    ['curb', [[18, 3], [13, 3], [4, 3]]],
    ['geopolitical', [[15, 1], [15, 3], [14, 1], [9, 3], [8, 3], [3, 2]]],
    ['sustain', [[10, 3], [9, 3]]],
    ['買う', [[9, 3], [8, 3]]],
    ['維持', [[7, 3], [6, 1], [6, 3], [4, 3]]],
    ['shrug off', [[1, 3]]],
  ];
  const reviews = [];
  for (const [lemma, steps] of history) {
    if (!byLemma[lemma]) continue;
    steps.forEach(([daysAgo, rating], i) => reviews.push({ cardId: byLemma[lemma], rating, durationMs: 3000 + i * 400, reviewedAt: now - daysAgo * day - (8 - i) * 60000 }));
  }
  reviews.sort((a, b) => a.reviewedAt - b.reviewedAt);
  const res2 = await fetch(`${API}/api/v1/reviews`, { method: 'POST', headers, body: JSON.stringify({ reviews }) }).then((r) => r.json());
  console.log(`review history: ${res2.results.filter((r) => r.ok).length}/${reviews.length} reviews over the last three weeks`);
} else {
  console.log(`review history left alone (${stats.totals.reviews} reviews already there; use --reset to start over)`);
}
