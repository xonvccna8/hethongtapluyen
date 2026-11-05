# RehabBoard AI — Web luyện tập (Vercel + Bluetooth)

Web tĩnh chạy trên Vercel. Web nối **thẳng với board** qua **Bluetooth LE**, hoặc qua **cáp USB** (Web Serial), để hiện số liệu khi tập. **ChatGPT** chạy qua hàm Vercel `api/ai.js` để phân tích và đưa lời khuyên. Không cần laptop chạy server.

```
Board ESP32-S3 ──Bluetooth / USB──> Trình duyệt (Chrome/Edge) ──HTTPS──> Vercel /api/ai ──> OpenAI
                                    lưu hồ sơ & buổi tập trên máy
```

## Dùng
1. Nạp `Firmwave/REHABBOARD_WEB` lên board. Tên Bluetooth của board là **REHABBOARD**, màn TFT báo trạng thái Bluetooth.
2. Mở trang Vercel bằng **Chrome hoặc Edge**:
   - Android, Windows, macOS: dùng được Bluetooth.
   - iPhone/iPad: phải dùng app trình duyệt *Bluefy*.
3. Bấm **🔵 Bluetooth**, chọn REHABBOARD. Trên máy tính có thể cắm cáp rồi bấm **🔌 USB** (đóng Arduino IDE trước).
4. Thêm người tập, bấm **⟲ Đặt 0 lực**, rồi vào **Luyện tập**.
5. Vào **Cài đặt** nhập **Mã truy cập AI**, sau đó dùng **Trợ lý AI**.

Hồ sơ và kết quả tập **lưu trên trình duyệt của máy đang dùng**. Dùng **Cài đặt → Sao lưu / Khôi phục** để chuyển dữ liệu sang máy khác, và nên sao lưu thường xuyên.

## Cấu hình Vercel (một lần)
Vào **Project → Settings → Environment Variables**, thêm:

| Biến | Giá trị |
|---|---|
| `OPENAI_API_KEY` | khoá OpenAI (`sk-…`), chỉ máy chủ Vercel thấy |
| `AI_ACCESS_CODE` | mã tự đặt; người dùng nhập mã này trong Cài đặt của web |
| `OPENAI_MODEL` | (tuỳ chọn) mặc định `gpt-5.5-mini` |

Đổi biến xong phải **Redeploy** để có hiệu lực.

## ⚠ Nguồn điện khi dùng Bluetooth
Sóng Bluetooth cần dòng lớn trong thời gian rất ngắn. Ngày 06/11/2026, board cấp nguồn qua cổng USB CH343 bị **sụt áp (brownout)** ngay khi bật Bluetooth. Firmware tự bảo vệ: nếu lần khởi động trước bị sụt áp thì lần sau **tắt Bluetooth**, vẫn chạy qua cáp USB, và màn TFT hiện `BLE: TAT (sut ap)`. Cách sửa:
- Dùng cáp USB tốt, ngắn, cắm thẳng vào máy hoặc vào **adapter 5 V ≥ 2 A**, không qua hub.
- Hàn **tụ 470–1000 µF** giữa 5V–GND và giữa 3V3–GND, đặt gần ESP32.
- Chuyển VCC/LED của màn TFT sang **5V** (đèn nền TFT chiếm nhiều dòng nhất trên 3V3).
- Sửa xong thì rút điện ra cắm lại. Board tự bật Bluetooth (TFT hiện `BLE: cho ket noi`).

## Các bài tập
| # | Bài | Đo gì | Điểm |
|---|---|---|---|
| 1 | Nhấn từng ngón | lực đỉnh, độ ổn định, khả năng tách ngón | 60 % lực + 25 % tách ngón + 15 % ổn định |
| 2 | Bóp tay | lực đỉnh 3 lần, giữ lực, độ đều | 70 % lực + 15 % giữ lực + 15 % đều tay |
| 3 | 9 lỗ (kiểu Nine-Hole Peg Test) | thời gian cắm/chạm đủ 9 lỗ, 2 vòng, nhịp đều | 80 % thời gian (≤ 10 s tối đa, ≥ 40 s = 0) + 20 % nhịp đều |
| 4 | Xoay núm | đạt 7 mục tiêu ±, thời gian, biên độ | theo số mục tiêu đạt và tốc độ |
| 5 | Thanh trượt | bám vạch đỏ 30 s: sai lệch, % trong vạch | 60 % trong vạch + 40 % sai lệch |
| 6 | Game phục hồi | phản xạ 12 lượt (đồng hồ của board), độ chính xác | 50 % chính xác + 50 % tốc độ |

Bài lực tự đặt 0 trước khi đo. Màn hình bỏ qua nhiễu nhỏ hơn 300 số đếm. Lực chưa hiệu chuẩn tính bằng đơn vị tương đối; vào **Cài đặt → Hiệu chuẩn lực** để đổi ra kg.

## Chạy thử trên máy
```
python -m http.server 8097 --directory web
```
Mở http://localhost:8097. Bluetooth và USB vẫn chạy được, vì trình duyệt coi localhost là trang an toàn. Riêng trợ lý AI chỉ chạy khi web đã ở trên Vercel.
