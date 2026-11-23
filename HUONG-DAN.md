# Teni AI: đưa lên Vercel, mã xác nhận gửi về Gmail

## A. Tạo "Mật khẩu ứng dụng" cho Gmail gửi thư (làm 1 lần)
Dùng một Gmail của bạn làm "người gửi" (nên tạo Gmail riêng cho Teni AI, ví dụ teniai.gui@gmail.com).
1. Vào myaccount.google.com, mục **Bảo mật**, bật **Xác minh 2 bước**.
2. Vào myaccount.google.com/apppasswords, đặt tên `Teni AI`, bấm Tạo.
3. Copy chuỗi 16 ký tự hiện ra. Đây là mật khẩu ứng dụng, **không phải mật khẩu Gmail**. Đừng gửi cho ai.

## B. Đưa lên Vercel
1. Giải nén file zip. Bạn sẽ thấy `index.html`, thư mục `api`, `package.json`.
2. Vào vercel.com, đăng nhập, rồi **Add New → Project**.
   - Cách dễ: đưa thư mục lên GitHub rồi chọn Import.
   - Hoặc dùng Vercel CLI: `npm i -g vercel`, mở terminal trong thư mục và gõ `vercel`.
3. Trước khi bấm Deploy, mở mục **Environment Variables** và thêm 5 biến (3 biến gửi mail + 2 biến Supabase ở phần C):

| Tên | Giá trị |
|---|---|
| `GMAIL_USER` | Gmail người gửi, ví dụ teniai.gui@gmail.com |
| `GMAIL_APP_PASSWORD` | 16 ký tự ở bước A (có hay không có khoảng trắng đều được) |
| `OTP_SECRET` | một chuỗi ngẫu nhiên dài từ 16 ký tự trở lên, tự gõ bừa, ví dụ `k8Zq2xW9mPb4Tn7vLc3Rj5` |

4. Bấm **Deploy**. Xong bạn có link dạng `ten-du-an.vercel.app`.
5. Mở link, vào tab Cá nhân, nhập Gmail của bạn. Mã 6 số sẽ về hộp thư (xem cả thư rác).

Nếu thêm biến sau khi đã deploy thì phải **Redeploy** thì biến mới có tác dụng.

## Lưu ý
- Gmail miễn phí gửi được khoảng 500 thư mỗi ngày.
- Mở file `index.html` trực tiếp trên máy thì **không gửi được mã** (cần chạy trên Vercel). Muốn thử trên máy, dùng `vercel dev`.

## C. Cơ sở dữ liệu Supabase (để dùng chung giữa các máy)
1. Trong Supabase, mở **SQL Editor → New query**, dán toàn bộ nội dung file `supabase/schema.sql`, bấm **Run**. Chạy lại nhiều lần vẫn an toàn.
2. Vào **Project Settings → API Keys**, chép khóa **service_role** (hoặc **Secret key** bắt đầu bằng `sb_secret_`). Đây là khóa mạnh nhất, **chỉ dán vào Vercel, không gửi cho ai, không đưa vào file HTML**.
3. Trong Vercel, thêm 2 biến môi trường:

| Tên | Giá trị |
|---|---|
| `SUPABASE_URL` | địa chỉ dự án, ví dụ `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | khóa service_role / secret ở bước 2 |

4. **Redeploy**. Khóa công khai (anon) không cần dùng: trang web không gọi thẳng Supabase mà đi qua máy chủ Vercel, nơi kiểm tra đăng nhập và vai trò trước khi đọc hoặc ghi dữ liệu.

### Những gì đã dùng chung giữa các máy
Tài khoản cá nhân, không gian học tập (mã `TENI-XXXX`, thành viên, mời, duyệt), vai trò, bài học 8 môn do giáo viên đăng, thông báo của giáo viên, **bài kiểm tra, bài làm, điểm và cảnh báo gian lận**.

### Quy tắc vai trò
- Học sinh tự chọn vai trò Học sinh và vào ngay. Ai chọn Giáo viên thì **người quản lý phải xác nhận** (mục "Xin làm giáo viên") rồi mới có quyền đăng bài học và thông báo.
- Chỉ giáo viên và quản lý được sửa bài học, gửi thông báo, xem danh sách học sinh. Chỉ quản lý được mời và duyệt thành viên.
- Nhập sai mã xác nhận 5 lần thì khóa email đó 15 phút.

### Chưa dùng chung (còn lưu trong trình duyệt)
Tài liệu tải lên, tiến độ học, ghi chú, thời khóa biểu và sơ đồ tư duy.

## D. Kiểm tra và chống gian lận
**Cập nhật:** chạy lại `supabase/schema.sql` (có thêm 3 bảng `exams`, `exam_attempts`, `exam_events`), rồi Redeploy. Không cần thêm biến môi trường.

### Giáo viên
- **Quản lý kiểm tra → Tạo bài kiểm tra**: nhập tên, môn, lớp, giờ bắt đầu, thời gian, soạn câu trắc nghiệm (chọn nút tròn ở đáp án đúng). Có ô **Bắt buộc bật camera và mic**.
- **Trang chủ → Giám sát kiểm tra**: thấy từng học sinh đang làm, tiến độ, đã nộp và điểm. Học sinh có cảnh báo hiện nút cam "⚠ n cảnh báo"; bấm vào xem từng sự kiện kèm giờ, thời lượng và ảnh nhỏ lúc xảy ra. Trang tự cập nhật mỗi 8 giây.
- Hệ thống **chỉ báo, không tự trừ điểm hay hủy bài**. Giáo viên quyết định.

### Học sinh
Mở **Giám sát thi cử → Vào làm bài**. Hộp thoại nêu rõ việc dùng camera/mic và học sinh bấm **Đồng ý** hoặc **Không đồng ý**. Đề bắt buộc camera mà không đồng ý thì không vào làm được. Đề không bắt buộc thì có thể làm không camera (giáo viên thấy ghi chú "không đồng ý bật camera").

### Những gì được báo cho giáo viên
| Sự kiện | Khi nào |
|---|---|
| Chuyển tab / ẩn trang | Ngay khi rời tab (kèm lúc quay lại) |
| Rời cửa sổ làm bài | Mất focus quá 1,5 giây |
| Thoát toàn màn hình | Ngay lúc thoát; học sinh bị chặn đến khi vào lại |
| Nhìn lệch hướng | Đầu hoặc mắt lệch về một phía liên tục từ 10 giây (nhắc lại mỗi 30 giây nếu vẫn lệch) |
| Không thấy khuôn mặt | Mất mặt khỏi khung hình từ 10 giây |
| Tiếng ồn kéo dài | Mic to liên tục từ 10 giây |
| Camera/mic bị tắt, lỗi | Ngay lúc xảy ra |

Ảnh nhỏ (160×120) được chụp kèm mỗi cảnh báo và 1 ảnh định kỳ mỗi 60 giây (chỉ giữ ảnh mới nhất). **Mic chỉ đo mức ồn, không ghi âm.**

### Cần biết
- **Phải xin sự đồng ý** của học sinh (và phụ huynh nếu học sinh nhỏ tuổi) trước khi dùng camera. Nên báo trước ở trường.
- Nhận diện hướng nhìn chạy **ngay trên máy học sinh** (MediaPipe, tải từ jsdelivr và storage.googleapis.com lần đầu), nên máy học sinh cần Internet. Nếu không tải được, camera vẫn chụp ảnh định kỳ và giáo viên thấy ghi chú.
- Ngưỡng nhìn lệch (quay đầu hơn khoảng 38%, liếc mắt ra ngoài khoảng 38–62%, cúi/ngẩng, mic 0,12) là **ước lượng ban đầu, chưa chỉnh bằng camera thật**. Hãy thử 1–2 bài với vài bạn rồi chỉnh trong `app.html` (khối `PX`). Kính, ánh sáng yếu hoặc màn hình đặt lệch có thể gây báo nhầm, vì vậy cần giáo viên xem ảnh trước khi kết luận.
- Trình duyệt iPhone/iPad không hỗ trợ toàn màn hình nên sẽ không có cảnh báo thoát toàn màn hình. Nên cho làm bài trên máy tính.
- Học sinh thông thạo vẫn có thể gian lận bằng thiết bị thứ hai. Đây là công cụ hỗ trợ, không phải bảo đảm tuyệt đối.
- Hiện mới có câu trắc nghiệm (tự chấm ở máy chủ, học sinh không thấy đáp án). Tự luận chưa có.
