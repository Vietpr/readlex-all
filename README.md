# ReadLex

Extension Chrome giúp đọc báo tiếng Anh và tiếng Nhật: rê chuột hoặc bôi đen để tra nghĩa tức thì, lưu từ
kèm đúng câu đang đọc, rồi để Gemini giải thích nghĩa theo ngữ cảnh, collocation và ví dụ để tối về học lại.

```
Đọc báo → hover / bôi đen → hiểu ngay → ☆ Lưu (kèm câu, trang, ngày)
        → Gemini enrich ở nền → Kho từ vựng (nghĩa theo ngữ cảnh, collocation, ví dụ, CEFR, độ đáng học)
```

Giai đoạn hiện tại: **extension tiếng Anh + tiếng Nhật, dữ liệu lưu cục bộ (IndexedDB)**. Backend và web ôn
tập (FSRS) là các giai đoạn sau, xem [docs/PLAN.md](docs/PLAN.md).

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
2. Bấm **Load unpacked**, chọn thư mục `extension/`.
3. Bấm icon ReadLex trên thanh công cụ → ⚙ **Cài đặt** → dán **Gemini API key**
   (lấy miễn phí tại https://aistudio.google.com/app/apikey) → bấm **Kiểm tra**.
4. Mở một bài báo tiếng Anh bất kỳ và dùng thử. Trang đã mở trước khi cài cần refresh.

## Cách dùng

| Thao tác | Kết quả |
|---|---|
| Rê chuột vào một câu (mặc định, chờ 300 ms) | Hộp xanh dịch **cả câu** dưới con trỏ, kiểu tudienjp. Chuyển câu khác thì đổi theo |
| Giữ `Shift` khi rê chuột | Tạm đổi sang tra **từ** dưới con trỏ: IPA, loại từ, nghĩa, ví dụ từ từ điển offline |
| Chế độ "câu + từ" (Cài đặt) | Hộp dịch câu kèm một dòng nghĩa của từ đang trỏ, có nút ☆ Lưu |
| Bôi đen hoặc nháy đúp một từ | Popup từ điển đầy đủ của từ đó, ghim lại tới khi bấm ra ngoài |
| Bôi đen một cụm / câu | Popup dịch cụm đó |
| Văn bản tiếng Nhật | Tự nhận ra theo ký tự. Rê chuột dịch câu như tiếng Anh; giữ Shift hoặc nháy đúp để tra từ: từ điển tự tìm ranh giới từ và đưa về dạng từ điển (買いました → 買う【かう】, kèm nhãn "quá khứ lịch sự"), tô sáng từ được nhận trên trang, kèm thông tin kanji (JLPT, số nét) |
| Bấm ☆ **Lưu** trong popup | Lưu từ kèm câu, đoạn, URL, tiêu đề trang. Toast có **Hoàn tác** |
| Chuột phải → *Lưu "…" vào ReadLex* | Như trên, không cần popup |
| `Alt+Shift+H` | Bật / tắt nhanh chế độ hover |
| Icon ReadLex | Từ lưu hôm nay, tìm nhanh, tắt trên trang này, số từ đang chờ AI |
| **Kho từ vựng** | Toàn bộ từ, lọc / sắp xếp, chi tiết AI, "bạn đã gặp từ này ở đâu", export JSON / Anki |

Trong **Cài đặt** có thể đổi: hover dịch câu / từ / cả hai, kích hoạt bằng rê chuột / giữ Alt / giữ Ctrl / tắt,
thời gian chờ, dịch ngay khi bôi đen hay hiện nút, bỏ qua từ thông dụng, theme popup, model Gemini, danh sách
trang bị tắt.

## Nguồn dữ liệu

- **Hover / bôi đen một từ**: từ điển Anh-Việt **offline** nằm ngay trong extension (`extension/dict/en-vi`,
  117.000 từ + 230.000 cụm 2–3 từ, 10 MB nén, nguồn OVDP `star_anhviet`, giấy phép GPLv2, gốc là Từ điển
  Anh-Việt của Hồ Ngọc Đức). Tra không cần mạng, khoảng 1 ms khi shard đã nạp. Dạng biến đổi (sustained,
  tariffs) được đưa về từ gốc bằng lemmatizer. Phát âm dùng Google TTS.
- **Dịch câu khi rê chuột, bôi đen cụm dài, hoặc từ không có trong từ điển**: Google Translate (endpoint `clients5`
  `dict-chrome-ex` nhanh và ít bị chặn, rồi `gtx`, cuối cùng MyMemory), mọi request có timeout, cache 30 ngày.
- **Lưu từ**: Gemini (`gemini-2.5-flash` mặc định) chỉ chạy sau khi lưu, tuần tự ~9 request/phút để nằm trong
  free tier, tự retry, tiếp tục sau khi service worker bị tắt. Không bao giờ gọi Gemini khi hover.

- **Tiếng Nhật**: từ điển offline `extension/dict/ja` ghép từ JMdict (218.000 mục, cách đọc, loại từ; EDRDG,
  CC BY-SA 4.0), KANJIDIC2 (10.384 kanji) và Từ điển Nhật-Việt OVDP (56.000 mục có nghĩa tiếng Việt, GPLv2),
  17 MB nén. Tra theo cách của Yomichan: lấy đoạn chữ từ vị trí con trỏ, thử tiền tố dài nhất trước, khử biến
  đổi động từ / tính từ ([ja-deinflect.js](extension/background/ja-deinflect.js)) rồi đối chiếu loại từ trong
  JMdict. Dịch câu tiếng Nhật đi qua Google như tiếng Anh. Từ chưa có nghĩa Việt thì hiện nghĩa tiếng Anh.

Dựng lại từ điển: `python3 scripts/build-dict.py` (Anh-Việt, tải ~18 MB) và `python3 scripts/build-dict-ja.py`
(Nhật, tải ~55 MB); dữ liệu tải về nằm trong `.cache/`.

## Backend và web

`backend/` là API trên Cloudflare Workers + D1 (xem [backend/README.md](backend/README.md)): tài khoản (đăng ký tự do), mỗi người một kho từ và một Gemini key riêng mã hóa trên server, flashcard và lịch ôn FSRS. `web/` là
app ôn tập dạng PWA host trên GitHub Pages (xem [web/README.md](web/README.md)). Luồng: đăng nhập cùng một tài
khoản ở extension và web → máy đọc lưu từ → Worker giải nghĩa bằng key của bạn → sáng mở web trên điện thoại để ôn.

## Cấu trúc

```
backend/                     Cloudflare Worker (Hono) + D1, migrations/, test/smoke.mjs
web/                         PWA ôn tập (Vite + React), deploy bằng .github/workflows/deploy-web.yml
extension/
├── manifest.json            MV3
├── background/
│   ├── service-worker.js    router message, context menu, alarms, badge
│   ├── db.js                IndexedDB (vocabulary, exposures, lookups, cache, outbox)
│   ├── offline-dict.js      từ điển Anh-Việt offline: nạp shard gzip, parse entry, tóm tắt cho popup
│   ├── ja-deinflect.js      khử biến đổi tiếng Nhật (買いました → 買う), test: scripts/test-ja-deinflect.mjs
│   ├── ja-dict.js           từ điển Nhật offline: quét tiền tố dài nhất, JMdict + KANJIDIC2 + Nhật-Việt
│   ├── translate.js         offline trước, rồi Google (clients5 / gtx) + MyMemory + cache
│   ├── lemmatizer.js        rule-based lemmatizer (sustained → sustain), test: scripts/test-lemmatizer.mjs
│   ├── vocabulary.js        lưu / gộp / thống kê / export / import / outbox
│   ├── enrich.js            hàng đợi Gemini, prompt, schema JSON
│   └── settings.js
├── content/
│   ├── locator.js           từ dưới con trỏ (caretPositionFromPoint + Intl.Segmenter), câu / đoạn ngữ cảnh
│   ├── ui.js                popup, nút dịch, toast trong Shadow DOM
│   └── main.js              hover, selection, context menu, lưu
├── dict/en-vi/              từ điển Anh-Việt offline (w/ = từ đơn, p/ = cụm 2–3 từ), tạo bởi scripts/build-dict.py
├── dict/ja/                 từ điển Nhật offline (idx/ khoá → id, ent/ mục từ, kanji/), tạo bởi scripts/build-dict-ja.py
├── popup/                   popup thanh công cụ
├── options/                 trang cài đặt
├── vocabulary/              kho từ vựng
└── shared/                  CSS + helper dùng chung cho các trang
```

## Mô hình dữ liệu

`vocabulary` (1 dòng / lemma) ↔ `exposures` (n câu / trang đã gặp) + `lookups` (số lần tra, kể cả chưa lưu).
Tách như vậy để sau này có "bạn gặp *fiscal* 7 lần ở Reuters, BBC, FT" và gợi ý lưu từ hay tra.

## Kiểm thử

```
npm test          # lemmatizer, parser Anh-Việt, khử biến đổi tiếng Nhật, quét từ điển Nhật trên shard thật
npm install       # một lần, cài puppeteer-core cho smoke test
npm run smoke     # mở Chrome headless thật, nạp extension, mock API, kiểm tra hover / bôi đen / lưu / AI / các trang
npm run smoke:live   # như trên nhưng gọi API thật (cần mạng + Gemini key đã lưu trong Cài đặt)
```

Smoke test nạp extension qua CDP (`browser.installExtension`) vì Chrome 137+ bản Google bỏ cờ `--load-extension`.
Nếu puppeteer-core nằm ở thư mục khác, đặt `PUPPETEER_DIR=/thư/mục/chứa/node_modules`.

## Backup

Dữ liệu nằm trong IndexedDB của extension. Hãy **Export JSON** định kỳ từ trang Kho từ vựng; file đó import
lại được và cũng là dữ liệu đầu vào cho backend sau này.
