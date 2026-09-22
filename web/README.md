# ReadLex Web

Ứng dụng ôn tập (PWA, cài được lên điện thoại) đọc dữ liệu từ backend Cloudflare. Không có server riêng:
chỉ là file tĩnh, host trên GitHub Pages.

## Màn hình (giao diện tiếng Anh)

Mô hình: **Saved words** (lưu không giới hạn) → **Daily Sets** (tự nhóm theo ngày, chỉ là cách xem) → **FSRS reviews**
(mỗi từ đúng một thẻ, lịch ôn độc lập với set).

- **Today**: thẻ đến hạn với nút Start review (flashcard, có chấm FSRS), **Today's words** với một nút chính
  (Start / Continue learning = chế độ Learn) và hàng link nhanh `Flashcards · Write · Listen · More`; từ các ngày
  trước chưa học; số liệu trong ngày ở cuối. Không bày sẵn cả loạt nút chế độ: `More` mở bảng chọn chế độ
  (bottom sheet trên điện thoại, hộp thoại trên desktop): Learn nổi bật ở trên, nhóm **Practice** (Flashcards, Write,
  Listen, Quick quiz, In context) và nhóm **Games** (Match, Recall sprint); chế độ không dùng được thì ghi rõ lý do.
- **AI điền nghĩa**: mọi chỗ gõ từ (Create set, Add words trong set, Add word) đều có nút ✨ cho từng dòng và nút
  "Fill N meanings with AI" ở dưới. Nút gọi `POST /api/v1/define` bằng key Gemini của chính user, chỉ điền vào ô nghĩa
  còn trống (không ghi đè chữ đã gõ, kể cả khi bạn gõ tiếp trong lúc chờ), tiếng Nhật điền luôn cả reading. Từ AI không
  nhận ra thì báo tên từ đó thay vì bịa nghĩa. Chưa có key thì báo lỗi kèm link sang Settings.
  Ngoài nghĩa ngắn để lên thẻ, AI trả kèm một khối giải thích ngay dưới dòng đang gõ: định nghĩa tiếng Anh,
  **When to use it** (dùng trong trường hợp nào), **When not to** (khi nào không dùng / dễ nhầm từ nào) và một câu ví dụ.
  Từ tiếng Anh thì phần này viết bằng tiếng Anh, từ tiếng Nhật vẫn tiếng Việt. Khối này đóng được, và cũng chính là
  mục "When to use it" trong "More details" của thẻ học.
- **Study** (`src/study/`, mọi chế độ dùng chung một thẻ và một lịch FSRS cho mỗi từ):
  - Mặt trước: ngôn ngữ · từ loại · trình độ, từ, IPA, nút loa. Mặt sau: từ → phát âm → **nghĩa (chữ to nhất)** →
    định nghĩa → **đúng một câu**: câu gốc bạn đã đọc nếu có ("Where you met it"), không có thì câu ví dụ AI sinh ra
    ("AI example"), không có cả hai thì một ô nét đứt nói rõ đang chờ AI — thẻ không bao giờ trống hoác. Collocations,
    synonyms, word family và câu ví dụ AI (khi đã có câu gốc) nằm trong "More details". Ghi chú AI **không** hiện trên
    thẻ học nữa, chỉ còn ở trang từ (mục "How to use it").
  - **Flashcards**: thẻ hai mặt thật. Chạm hoặc Space để lật qua lại, **nhấn giữ để xem nhanh mặt sau** (thả ra
    quay về), nút loa và "More details" không làm lật thẻ, 1–4 để chấm. Ba hướng (chỉ là cách trình bày):
    Word → Meaning, Meaning → Word, Context (câu gốc bị che từ). Mặt sau theo thứ tự từ → phát âm → nghĩa →
    định nghĩa → ví dụ → câu gốc; collocations, synonyms, word family, notes nằm trong "More details".
  - **Write**: gõ từ theo nghĩa + câu che từ. Chấm theo nghĩa nên chấp nhận mọi dạng của từ; còn **In context → "Type it"**
    chỉ chấp nhận đúng dạng mà câu cần (`contemplated`, không phải `contemplate`) — chỗ khác nhau được tô trong phần đối chiếu.
    Sai thì hiện "Your answer / Correct answer" có tô chỗ khác nhau,
    có nút "I was right" và "I don't know". Chấm theo chữ sau khi chuẩn hóa hoa thường, khoảng trắng, dấu câu,
    katakana/hiragana; không chấm mờ. Từ sai quay lại cuối phiên.
  - **Listen**: nghe rồi gõ (Play again, Slower, "I can't listen right now" để bỏ qua không tính điểm).
  - **Multiple choice** và **Context challenge** (câu gốc bị che từ; chọn đáp án hoặc "Type it"). Đáp án nhiễu
    lấy trong phiên, thiếu thì mượn từ kho, ưu tiên cùng từ loại; không đủ thì tự chuyển sang gõ.
  - **Learn**: đầu màn hình có thanh bậc thang của chính từ đó (Meet · Choose · Context · Write · Listen), bậc đang làm
    được tô sáng, bậc đã qua có dấu tích; nút sau khi lật thẻ nói luôn bậc kế tiếp ("Next: pick the meaning"). Mỗi từ leo thang `study → choice → context → write (→ listen với từ đã vào long-term)`; đúng lên
    một bậc, sai xuống một bậc và quay lại sau 2 câu; chia vòng tối đa 6 từ có checkpoint. Máy trạng thái thuần
    ở `src/study/learn.ts`. Khi một từ leo xong mới gửi **một** review: không sai = Good, sai 1 lần = Hard,
    sai từ 2 lần = Again.
  - **Match**: game ghép 6 từ với 6 nghĩa, bấm giờ, ghép sai cộng 2 giây, kỷ lục lưu trong localStorage.
    **Không bao giờ** gửi review.
  - **Recall sprint**: 45 giây, xen kẽ câu hỏi nghĩa → từ và câu gốc → từ, +100 mỗi câu đúng cộng thưởng chuỗi
    (+10 mỗi bậc, tối đa +100), sai thì mất chuỗi; điểm cao nhất lưu trong localStorage. Cũng chỉ là luyện tập.
  - Quy tắc FSRS: chỉ từ mới hoặc đến hạn mới được ghi vào lịch. Từ chưa đến hạn là "Practice only" (có ghi
    chú ngay trên màn hình), Match luôn là luyện tập.
- **Library** xoay quanh set: tab **All Sets** (My Sets + Daily Sets trên một trang), Daily Sets (tự động theo ngày), My Sets.
  Ô tìm kiếm trên cùng tìm từ trong toàn bộ kho (gõ là hiện danh sách từ), nút **Add word** thêm một từ lẻ (vào set của hôm nay).
  My Sets tạo bằng form kiểu Quizlet: tiêu đề, ngôn ngữ, các dòng term – meaning (tiếng Nhật có thêm cột reading), Enter để
  xuống dòng/thêm dòng. Trong set, **Add words** mặc định là gõ từ mới (cùng form), tab phụ "Pick from library" để chọn từ có sẵn;
  tìm không thấy thì có nút "Add “…” as a new word". Từ gõ vào cũng vào Library và giữ một lịch FSRS, nghĩa tự gõ là nghĩa hiển
  thị trên thẻ (AI không ghi đè). Đổi tên, bỏ từ, xóa set; xóa set không xóa từ. Trang set có thẻ tiến độ (studied / new /
  learning / long-term review + thanh phần trăm), trạng thái New / Learning / Review (kèm nhãn due) trên từng từ và cùng bộ nút học.
- **Xóa từ**: nút thùng rác có ở ngay mỗi dòng trong Daily Set và trong kết quả tìm kiếm, không chỉ ở trang từ.
  Xóa một từ là cách duy nhất để nó biến mất khỏi Today và khỏi mọi set (kèm câu và lịch sử ôn), nên hộp xác nhận nói rõ điều đó.
  Xóa **set** thì hỏi hẳn hai lựa chọn: "Delete set, keep the words" hoặc "Delete set and its N words" — trước đây mặc định giữ từ
  nên xóa set xong Today vẫn còn từ, rất dễ tưởng là lỗi. Chip từ trong "Today's words" bấm được để mở thẳng trang từ.
- **Trang từ**: sửa từ gốc, cách đọc, nghĩa hiển thị trên thẻ, ghi chú; xóa từ; xóa từng câu; bật tắt từ trong các set.
- **Progress**: bốn ô tóm tắt (day streak, words learned = đã học ít nhất một lần, recall rate, reviews this week),
  Learning progress (New / Learning / Long-term review, không dùng chữ "mastered"), heatmap 12 tuần, Recall rate
  (= tỉ lệ review chấm Hard/Good/Easy, Again là trượt; có ghi rõ cách tính), **Needs attention** (từ bị Again từ
  2 lần trong 90 ngày) với nút Practice difficult words, 30 ngày lưu từ, CEFR / JLPT.
- Nếu backend chạy với `GEMINI_MOCK=1`, Settings hiện cảnh báo đỏ ("fake Gemini") và mỗi lần bấm ✨ cũng nói rõ nghĩa
  vừa điền là giả lập — vì ở chế độ đó mọi key đều "lưu thành công" mà không hề được kiểm tra.
- **Settings**: Account, AI assistance (Gemini key, model trong Advanced), Learning (bật tắt English / Japanese),
  Pronunciation (accent, voice, speed, auto-play), Data & Sync, App (time zone tự động theo tên vùng), Danger zone.
- **Sign in / Create account / Forgot / Reset password**: hai cột trên desktop.

Phát âm: bản ghi từ điển nếu có, không thì Web Speech API của thiết bị (miễn phí, offline), cuối cùng mới tới URL
server gợi ý.

**Lượt ôn không bao giờ mất.** Mỗi lần chấm được xếp hàng trong localStorage kèm một id riêng rồi mới gửi. Các lần gửi
nối tiếp nhau chứ không chạy song song; một lượt chỉ rời hàng đợi khi server trả lời **cho đúng lượt đó** (thành công, hoặc
thẻ đã bị xóa hẳn). Mất mạng, hết phiên đăng nhập (401), 429 hay 5xx đều giữ nguyên hàng đợi. Server dùng id đó để
chống trùng: gửi lại một lượt đã ghi sẽ không lên lịch FSRS lần hai. Trong phiên học, header hiện "N waiting to sync"
nếu còn lượt chưa gửi.

**Tải lại trang không mất phiên học.** Phiên (và vị trí đang học, kể cả trạng thái của Learn) được mirror sang
sessionStorage — riêng từng tab, có đánh version, tự hết hạn sau 6 giờ.

## Chạy cục bộ

```
cd web && npm install && npm run dev        # http://localhost:5173
```
Backend cục bộ: `cd backend && npm run dev` (Gemini giả lập) hoặc `npm run dev:real` (Gemini thật, dùng key bạn lưu trong Settings); bản dev của web
tự trỏ về `http://localhost:8787`. Tài khoản demo: `node scripts/seed-local.mjs` (demo@readlex.local / demo12345).

E2E (backend giả lập + web bản build + Chrome headless, có cả chuột, phím, chạm và nhấn giữ): `cd web && npm run build && cd .. && node scripts/web-smoke.mjs`.
Test logic học (chấm đáp án, diff, tạo lựa chọn, máy trạng thái Learn): `node scripts/test-study-logic.mjs`.
`node scripts/seed-local.mjs --reset` dựng lại tài khoản demo kèm lịch sử ôn 3 tuần.

## Deploy lên GitHub Pages

1. Push repo lên GitHub (nhánh `main`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Trong repo: Settings → Secrets and variables → Actions → **Variables** → thêm `VITE_API_URL` =
   `https://readlex-api.<tên>.workers.dev` để web biết server (không thì người dùng phải nhập tay).
4. Workflow `.github/workflows/deploy-web.yml` tự build với `VITE_BASE=/<tên-repo>/` và publish. Địa chỉ:
   `https://<user>.github.io/<tên-repo>/`.
5. Mở trên điện thoại, đăng ký hoặc đăng nhập, rồi "Thêm vào màn hình chính".

Nếu repo private mà tài khoản GitHub free, Pages không hoạt động: để repo public (code không chứa dữ liệu hay
token) hoặc tách `web/` ra một repo public riêng.
