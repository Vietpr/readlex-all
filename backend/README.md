# ReadLex API (Cloudflare Workers + D1)

Backend nhiều người dùng: tài khoản email + mật khẩu (ai cũng đăng ký được, có thể khóa bằng mã mời), mỗi người một
kho từ và một Gemini key riêng (mã hóa trên server), flashcard và lịch ôn FSRS cho web.

```
extension (máy công ty) ──POST /api/v1/sync──▶ Worker ──▶ D1 (SQLite)
                                                  │
                                                  ├─ waitUntil / cron 15 phút: Gemini enrich
web / điện thoại ◀── GET /today, POST /reviews ───┘
```

## Chạy cục bộ (không cần tài khoản)

```
cd backend
npm install
npm run db:migrate:local
npm run dev                     # http://localhost:8787, D1 giả lập trong .wrangler/
npm run dev                     # local, Gemini giả lập (mọi giải thích là "mock")
npm run dev:real                # local, gọi Gemini THẬT bằng key user đã lưu trong Settings
npm test                        # smoke test: sync → enrich (mock) → today → reviews → stats → import
```

Khi dev cục bộ: `npx wrangler dev --var GEMINI_MOCK:1` (`GEMINI_MOCK=1` trả kết quả
giả, không cần key). Tạo tài khoản demo kèm dữ liệu mẫu: `node ../scripts/seed-local.mjs` (demo@readlex.local / demo12345).

## Deploy lần đầu (máy cá nhân, mạng không chặn api.cloudflare.com)

1. `cd backend && npm install && npx wrangler login` (mở trình duyệt, đăng nhập Cloudflare).
2. Tạo database: `npx wrangler d1 create readlex`. Lệnh in ra `database_id`, dán vào `wrangler.toml`
   thay cho dãy `0000…`.
3. Tạo bảng: `npm run db:migrate`.
4. Secrets (không nằm trong code):
   ```
   openssl rand -hex 32 | npx wrangler secret put ENCRYPTION_KEY   # khóa mã hóa Gemini key của người dùng, KHÔNG được đổi sau này
   ```
   Tuỳ chọn, để có "Quên mật khẩu": tạo tài khoản https://resend.com (free 3.000 email/tháng, cần xác minh một
   tên miền), rồi `npx wrangler secret put RESEND_API_KEY` và điền `MAIL_FROM`, `WEB_URL` trong `wrangler.toml`.
   Chưa cấu hình thì nút Quên mật khẩu báo người dùng liên hệ quản trị.
   Không có `API_TOKEN` hay `GEMINI_API_KEY` dùng chung: mỗi người dán key Gemini của mình trong Cài đặt của web
   hoặc extension. Đăng ký mặc định mở cho mọi người (`SIGNUP_MODE = "open"`, giới hạn 10 tài khoản mới mỗi IP
   mỗi giờ). Muốn hạn chế: `SIGNUP_MODE = "invite"` kèm `wrangler secret put INVITE_CODE`, hoặc `"closed"`.
5. `npm run deploy`. Wrangler in ra URL dạng `https://readlex-api.<tên>.workers.dev`. Cron 15 phút được
   đăng ký tự động.
6. Kiểm tra: mở `https://readlex-api.<tên>.workers.dev/api/v1/health` → `{"ok":true,"signup":"open","encryption":"env"}`.
   Người đăng ký đầu tiên là quản trị.

Muốn siết CORS: sửa `ALLOWED_ORIGINS` trong `wrangler.toml` thành
`https://<user>.github.io,chrome-extension://<id-extension>` rồi deploy lại.

## Nối extension

Cài đặt ReadLex → **Tài khoản ReadLex** → địa chỉ server, email, mật khẩu → **Đăng nhập** hoặc **Đăng ký tài khoản mới** (Chrome sẽ hỏi quyền truy cập tên miền) → dán **Gemini key của bạn** → **Đẩy toàn bộ dữ liệu lên
server** để nạp các từ đã lưu trước đó. Từ lúc này mỗi lần lưu từ, extension gửi ngay lên server; Gemini
chạy trên server bằng key của bạn và kết quả được kéo về máy để popup vẫn hiện nghĩa AI.

Để người dùng không phải gõ địa chỉ server: điền `DEFAULT_BACKEND_URL` trong `extension/background/settings.js`
và build web với `VITE_API_URL=https://readlex-api.<tên>.workers.dev`.

## Deploy tự động sau này

Cloudflare Dashboard → Workers & Pages → Create → Import a repository → chọn repo, root directory
`backend`, build command để trống, deploy command `npx wrangler deploy`. Từ đó mỗi lần push là deploy,
không cần chạy wrangler từ máy công ty. Secrets và `database_id` vẫn giữ nguyên.

## API

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/api/v1/auth/register` | `{email, password, inviteCode?, kind}` → token; người đầu tiên là admin |
| POST | `/api/v1/auth/login` | `{email, password, kind: web\|extension, label}` → token (web 60 ngày, extension 365 ngày, tự gia hạn) |
| POST | `/api/v1/auth/forgot`, `/auth/reset` | gửi email đặt lại mật khẩu (Resend), đặt mật khẩu mới bằng liên kết 60 phút, thu hồi mọi phiên cũ |
| POST/GET | `/api/v1/auth/logout`, `/auth/me`, `/auth/tokens` | phiên hiện tại, danh sách phiên, thu hồi |
| PUT/DELETE | `/api/v1/me/gemini` | `{apiKey, model}`: kiểm tra với Gemini rồi lưu mã hóa; không bao giờ trả key về |
| PATCH/DELETE | `/api/v1/me` | đổi mật khẩu, cài đặt; xóa tài khoản kèm toàn bộ dữ liệu |
| GET | `/api/v1/health` | công khai: phiên bản, chế độ đăng ký |
| POST | `/api/v1/sync` | `{op, payload, clientCreatedAt}` hoặc `{ops:[…]}`; op: `vocabulary.save` `{vocabulary, exposure}` (`vocabulary.userMeaning` = nghĩa người dùng tự gõ, ưu tiên hơn nghĩa AI khi hiện thẻ), `vocabulary.update` `{id, patch}`, `vocabulary.delete` `{id}`, `lookup.record` |
| POST | `/api/v1/import` | file Export JSON của extension, gộp theo (language, lemma) |
| GET | `/api/v1/vocabulary` | `query, status, language, enrichment, sort, limit, offset, since` |
| GET/PATCH/DELETE | `/api/v1/vocabulary/:id` | chi tiết kèm exposures, thẻ, lịch sử ôn; PATCH `{status, note, suspended, lemma, reading, meaning}` (meaning là nghĩa người dùng tự sửa, ưu tiên hơn nghĩa AI) |
| GET/POST | `/api/v1/custom-sets` | set do người dùng tạo; `GET/PATCH/DELETE /custom-sets/:id`, `POST /:id/items {vocabularyIds}`, `DELETE /:id/items/:vocabularyId`. Xóa set không xóa từ |
| DELETE | `/api/v1/exposures/:id` | xóa một câu ngữ cảnh |
| POST | `/api/v1/vocabulary/:id/enrich` | chạy lại Gemini cho một từ |
| POST | `/api/v1/enrich/run` | chạy hàng đợi Gemini ngay (cron cũng làm việc này) |
| GET | `/api/v1/today` | `tz` (phút lệch UTC, web tự tính), `language`: mọi thẻ đến hạn + mọi thẻ chưa học (tối đa 500), không có giới hạn từ mới mỗi ngày |
| GET | `/api/v1/sets`, `/api/v1/sets/:date` | Daily Sets: từ đã lưu nhóm theo ngày địa phương; chi tiết một ngày trả nội dung thẻ. Set chỉ là cách xem, mỗi từ vẫn một thẻ FSRS |
| POST | `/api/v1/reviews` | `{cardId, rating 1-4, durationMs}` hoặc `{reviews:[…]}` → lịch mới. Mỗi lượt có thể kèm `id` do client sinh: gửi lại cùng `id` trả `duplicate: true` và **không** lên lịch FSRS lần hai (cột `reviews.client_id`, migration 0003) |
| GET | `/api/v1/stats` | `tz`, `days` (30–120, web dùng 84 cho heatmap): tổng (kèm `again`, `learnedWeek`), chuỗi ngày, `perDay`/`savedPerDay`, `recall` {d7, d30, all} = {reviews, again} (recall rate = (reviews − again) / reviews), phân bố CEFR/JLPT |
| POST | `/api/v1/define` | `{language, terms:[…]}` (tối đa 20 từ/lần): gọi Gemini bằng key của chính user, trả `items[]` đúng thứ tự với `meaningVi` (ngắn, để lên thẻ), `definitionEn`, **`usage`** (khi nào dùng) và **`notUsed`** (khi nào không dùng / dễ nhầm với từ nào) bằng tiếng Anh cho từ tiếng Anh, `example`, `reading`, `ipa`, `partOfSpeech`, `level`, `unknown`. Không lưu gì vào DB — dùng cho nút "Fill with AI" lúc gõ từ |
| GET | `/api/v1/difficult` | `limit`: thẻ bị chấm Again từ 2 lần trong 90 ngày gần nhất (bỏ từ ignored/known/suspended), kèm nội dung thẻ để luyện ngay |
| GET | `/api/v1/lookups/frequent` | từ tra nhiều nhưng chưa lưu |

Mọi request (trừ health, register, login) cần header `Authorization: Bearer <token phiên>`. Dữ liệu luôn được lọc theo
tài khoản của token.
