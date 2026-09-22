# ReadLex · kế hoạch tổng thể

## Mục tiêu

Biến tiếng Anh đọc hằng ngày thành khóa từ vựng cá nhân:

```
READ → HOVER → UNDERSTAND → SAVE (kèm ngữ cảnh) → AI ENRICH → LEARN → REVIEW (spaced repetition)
```

Điểm khác biệt so với Google Translate / Anki: mỗi từ gắn với câu thật bạn đã đọc, và hệ thống biết bạn đã
gặp / tra từ đó bao nhiêu lần ở đâu.

## Ba thành phần

| Thành phần | Trạng thái | Vai trò |
|---|---|---|
| Chrome extension (tiếng Anh + tiếng Nhật) | **đã dựng, giai đoạn 1** | tra nhanh offline, dịch câu, lưu kèm ngữ cảnh, Gemini enrich, kho từ vựng cục bộ |
| Backend (FastAPI + PostgreSQL) | giai đoạn 2 | login, đồng bộ nhiều máy, enrich tập trung, API cho web |
| Web học từ (Today / Vocabulary / Review, FSRS) | giai đoạn 3 | flashcard cloze từ câu gốc, lịch ôn, thống kê |
| Tiếng Nhật | **đã dựng** (không cần tokenizer: quét + khử biến đổi kiểu Yomichan) | 買いました → 買う【かう】, nghĩa Việt/Anh, kanji, JLPT |

## Quyết định kiến trúc đã chốt

1. **Hover không gọi mạng, càng không gọi LLM.** Hover = từ điển Anh-Việt offline đóng gói trong extension
   (như cách tudienjp.com làm với Nhật-Việt). Google chỉ cho cụm dài / từ lạ. LLM chỉ chạy lúc Save, ở nền, có pacing.
2. **Vocabulary tách Exposure.** Một lemma nhiều câu / nguồn. Dedupe theo lemma (lemmatizer cục bộ, Gemini
   trả lemma chuẩn và gộp lại nếu khác).
3. **Extension tự chạy không cần backend.** Dữ liệu ở IndexedDB, có export / import JSON. Khi có backend, module
   `outbox` trong `vocabulary.js` đẩy thay đổi lên `POST /api/v1/sync`; extension không phải viết lại.
4. **Lookup tracking.** Mỗi lần tra một từ (hover / bôi đen) được đếm theo lemma, không lưu nội dung trang.
   Dùng cho "Bạn đã tra X 5 lần, lưu không?" và ưu tiên học.
5. **Một thẻ cloze / từ** khi làm review, để số lượng ôn không phình.

## Dữ liệu (đã dùng trong extension, backend nên giữ nguyên tên trường)

```
vocabulary   id, language, kind(word|phrase), lemma, surface, status(new|learning|known|ignored),
             quickMeaning, quickDict[], ipa, audio,
             enrichment{lemma, partOfSpeech, ipa, meaningVi, meaningInContext, sentenceVi, definitionEn,
                        cefr, collocations[], example, exampleVi, synonyms[], wordFamily[], notes,
                        learningPriority(1-5), isProperNoun, model, enrichedAt},
             enrichmentStatus(pending|processing|done|failed), enrichmentError, enrichmentAttempts,
             exposureCount, createdAt, updatedAt
exposures    id, vocabularyId, surface, sentence, paragraph, url, pageTitle, encounteredAt
lookups      lemma, count, firstSeenAt, lastSeenAt, surfaces[], sites[]
(giai đoạn 3)
flashcards   id, vocabularyId, type(cloze|recognition), front, back
reviews      id, flashcardId, rating(again|hard|good|easy), reviewedAt, stability, difficulty, due
```

## API dự kiến của backend (khớp với message của extension)

```
POST /api/v1/sync                 {op: vocabulary.save|vocabulary.update|vocabulary.delete, payload}
GET  /api/v1/vocabulary?query=&status=&sort=
GET  /api/v1/vocabulary/:id       vocabulary + exposures + lookups
POST /api/v1/vocabulary/:id/enrich
GET  /api/v1/reviews/today
POST /api/v1/reviews/:cardId      {rating}
GET  /api/v1/stats
```

## Roadmap

1. ✅ Extension tiếng Anh: hover, bôi đen, chuột phải lưu, cache, Gemini enrich, popup, kho từ vựng, export.
2. Dùng thật 1–2 tuần, sửa UX hover trên các trang báo hay đọc (Reuters, BBC, Bloomberg, Medium, Substack).
3. Backend FastAPI + PostgreSQL + login; bật `backendUrl` trong extension; import JSON đã export.
4. Web: Today / Vocabulary / Review với `ts-fsrs`, thẻ cloze từ câu gốc.
5. AI ranking "hôm nay nên học 9 từ", gợi ý từ tra nhiều, thống kê theo chủ đề / CEFR.
6. ✅ Tiếng Nhật: JMdict + KANJIDIC2 + Nhật-Việt OVDP, khử biến đổi trong extension, không cần Kuromoji.

## Rủi ro đã biết

- Endpoint Google `clients5` / `gtx` không chính thức, có thể đổi; đã có fallback MyMemory và timeout. Nhờ từ điển
  offline, phần lớn thao tác không đụng tới Google nữa.
- Từ điển OVDP là GPLv2: nếu phát hành công khai extension phải giữ giấy phép tương thích; dùng cá nhân thì không sao.
- Free Dictionary API chậm, chỉ còn dùng để bổ sung IPA cho từ không có trong từ điển offline, có timeout 2,5 s.
- Free tier Gemini giới hạn theo phút / ngày; hàng đợi tự tạm dừng 60 s khi bị 429 và chạy tiếp theo alarm.
- Lemmatizer quy tắc có thể sai với từ hiếm; Gemini trả lemma chuẩn và hệ thống tự gộp.
