# REHABBOARD AI — Hệ thống AI phục hồi bàn tay theo mô-đun

Dự án KHKT 2026–2027: bảng luyện tập phục hồi chức năng bàn tay dùng ESP32-S3. Web trên Vercel nối board qua **Bluetooth**, hiện số liệu khi tập và chấm điểm **Hand Recovery Score**. Trợ lý **ChatGPT** phân tích số liệu và đưa lời khuyên tập luyện.

## Mô-đun luyện tập
| # | Mô-đun | Phần cứng |
|---|---|---|
| 1 | Nhấn từng ngón | 5 load cell + 5 HX711 |
| 2 | Bóp tay | 1 load cell + HX711 |
| 3 | 9 lỗ (kiểu Nine-Hole Peg Test) | 9 công tắc đáy lỗ, nối song song vào GPIO10 |
| 4 | Xoay núm | Rotary encoder |
| 5 | Thanh trượt | Biến trở trượt |
| 6 | Game phục hồi | 4 nút + 4 LED + còi |

Màn hình TFT ILI9341 (320×240 ngang) hiển thị trực tiếp trên board.

## Thư mục
- `Firmwave/`: code Arduino cho ESP32-S3.
  - `REHABBOARD_WEB/`: firmware chính. Gửi số liệu qua Bluetooth LE và cáp USB, nhận lệnh từ web.
  - `REHABBOARD_TEST_TONGHOP/`: test tất cả mô-đun trên màn TFT.
  - Các thư mục còn lại: test riêng từng mô-đun.
- `web/`: web luyện tập (tĩnh, chạy trên Vercel). Nối board bằng Bluetooth hoặc USB ngay trong trình duyệt. Xem [web/README.md](web/README.md).
- `api/ai.js`: hàm Vercel gọi ChatGPT. OpenAI API key nằm trong biến môi trường của Vercel.
- `SoDo/`: script vẽ sơ đồ đi dây, xuất ra `RehabBoard_Ket_noi_v2.pdf`.
- `RehabBoard_Ket_noi_v2.pdf`: sơ đồ nối dây theo dây thực tế đã test. `RehabBoard_Ket_noi.pdf` là bản cũ.

## Triển khai
1. Nạp `Firmwave/REHABBOARD_WEB` lên board (Arduino IDE → ESP32S3 Dev Module).
   - Thư viện cần cài: Adafruit ILI9341, Adafruit GFX, U8g2_for_Adafruit_GFX, NimBLE-Arduino.
2. Import repo này vào Vercel (Framework: Other; `vercel.json` đã cấu hình sẵn).
3. Thêm biến môi trường `OPENAI_API_KEY` và `AI_ACCESS_CODE` (tuỳ chọn thêm `OPENAI_MODEL`), rồi Redeploy.
4. Mở trang Vercel bằng Chrome/Edge, bấm **🔵 Bluetooth** để nối board.

> Lời khuyên của AI chỉ để tham khảo, không thay thế chỉ định của bác sĩ / kỹ thuật viên phục hồi chức năng.
