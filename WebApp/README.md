# RehabBoard AI — Web theo dõi luyện tập + Trợ lý AI

Web hiển thị số liệu người bệnh khi tập trên RehabBoard. Dữ liệu cập nhật trực tiếp khoảng 18–20 lần/giây. Mỗi buổi tập được chấm điểm theo **Hand Recovery Score** và lưu tiến triển theo ngày. ChatGPT (model mặc định `gpt-5.5-mini`) đọc số liệu để phân tích và đưa lời khuyên tập luyện.

## Chạy
1. Nạp firmware **`Firmwave/REHABBOARD_WEB`** lên board (Arduino IDE: ESP32S3 Dev Module, COM9).
2. **Đóng Arduino IDE / Serial Monitor**, vì web cần giữ cổng COM.
3. Bấm đúp `WebApp/CHAY_WEB.bat`, hoặc chạy lệnh:
   ```
   python WebApp/server.py
   ```
4. Mở trình duyệt: **http://localhost:8095**

Web chỉ dùng số liệu thật từ board. Chế độ mô phỏng (`--demo`, bệnh nhân ảo) chỉ để phát triển giao diện, không có trong trang Cài đặt và không dùng khi tập thật.

Muốn mở bằng máy tính bảng cùng Wi-Fi: chạy `python WebApp/server.py --host 0.0.0.0`, rồi mở `http://<IP-máy-tính>:8095`.

## Bật trợ lý AI
Vào **Cài đặt → Trợ lý AI** và dán OpenAI API key (bắt đầu bằng `sk-…`), rồi bấm **Lưu cài đặt**.
- Khoá chỉ lưu trong `WebApp/config.json` trên máy này. Chỉ server dùng khoá, trình duyệt không bao giờ nhận lại.
- Cách khác: đặt biến môi trường `OPENAI_API_KEY`.
- Model đổi được trong Cài đặt. Nếu tài khoản báo không có `gpt-5.5-mini`, trang AI sẽ hiện lỗi; khi đó gõ tên model khác mà tài khoản của bạn có.

## Các bài tập (theo poster)
| # | Bài | Đo gì | Điểm |
|---|---|---|---|
| 1 | Nhấn từng ngón | lực đỉnh, độ ổn định, **khả năng tách ngón** (các ngón khác có bị kéo theo không) | 60 % lực + 25 % tách ngón + 15 % ổn định |
| 2 | Bóp tay | lực đỉnh 3 lần, giữ lực (giây cuối / đỉnh), độ đều | 70 % lực + 15 % giữ lực + 15 % đều tay |
| 3 | 9 lỗ (thay Kẹp ngón) | kiểu Nine-Hole Peg Test: cắm/chạm đủ 9 lỗ, 2 vòng — thời gian, nhịp đều, thời gian giữ mỗi lần chạm. 9 công tắc đáy lỗ nối song song vào GPIO10 nên chỉ đếm số lần chạm, không biết lỗ nào | 80 % thời gian (≤ 10 s tối đa, ≥ 40 s = 0) + 20 % nhịp đều |
| 4 | Xoay núm | đạt 7 mục tiêu ±, thời gian, biên độ | theo số mục tiêu đạt và tốc độ |
| 5 | Thanh trượt | bám theo vạch đỏ 30 s: sai lệch %, % thời gian trong vạch | 60 % trong vạch + 40 % sai lệch |
| 6 | Game phục hồi | phản xạ 12 lượt với 4 LED/nút: thời gian, độ chính xác | 50 % chính xác + 50 % tốc độ |

Độ chính xác khi đo thật:
- Bài nhấn ngón và bóp tay **tự đặt 0 lực** trước khi bắt đầu (load cell trôi theo thời gian). Lúc đó không chạm vào phím.
- Màn hình bỏ qua dao động nhỏ hơn 300 số đếm (nhiễu HX711 khi không chạm). Điểm vẫn tính bằng số đo thật.
- Phản xạ trong game đo bằng **đồng hồ của board**, từ lúc LED sáng tới lúc nút được nhấn, nên không dính trễ USB hay trình duyệt.

**Hand Recovery Score** mỗi ngày là trung bình điểm mới nhất của từng bài tập. Lực chưa hiệu chuẩn hiển thị bằng *đơn vị tương đối* (nghìn số đếm HX711). Muốn hiển thị bằng kg thì vào **Cài đặt → Hiệu chuẩn lực**.

Khi tập, **giữ tab web đang mở trên màn hình**: trình duyệt làm chậm đồng hồ của các tab bị ẩn.

## Tệp
- `server.py`: FastAPI. Đọc board qua USB, gửi dữ liệu trực tiếp lên web (SSE), lưu SQLite `data/rehab.db`, gọi OpenAI.
- `static/`: giao diện (`index.html`, `style.css`, `app.js`).
- Giao thức board: xem đầu file `Firmwave/REHABBOARD_WEB/REHABBOARD_WEB.ino`.
