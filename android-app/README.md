# App Android RehabBoard AI

Giao diện **giống hệt web** (dùng chung thư mục `web/`), chạy trên điện thoại Android, nối board bằng **Bluetooth LE gốc của Android**.

## Cài lên điện thoại

1. Chép file `RehabBoardAI.apk` vào điện thoại (Zalo, cáp USB, Google Drive...).
2. Mở file trên điện thoại → cho phép **cài ứng dụng không rõ nguồn** nếu được hỏi → **Cài đặt**.
3. Mở app **RehabBoard AI** → bấm **🔵 Bluetooth** → cho phép **Thiết bị ở gần** → chọn **REHABBOARD**.

> Board phải đang **bật Bluetooth**: màn TFT ghi `BLE: cho ket noi`. Nếu ghi `BLE: TAT (sut ap)` thì board tự tắt
> Bluetooth vì sụt áp nguồn — app (cũng như web) không thể thấy board cho tới khi sửa nguồn.

## Khác với web

| | Web (Chrome) | App Android |
|---|---|---|
| Bluetooth | Web Bluetooth | Bluetooth LE gốc (plugin `@capacitor-community/bluetooth-le`) |
| Cáp USB | Có (Web Serial) | Ẩn nút USB (điện thoại không có cổng COM) |
| Trợ lý AI | `/api/ai` trên Vercel | Gọi `https://hethongtapluyen.vercel.app/api/ai` (cần Internet) |
| Dữ liệu người tập | Lưu trong trình duyệt | Lưu trong app (riêng từng máy; chuyển máy: Cài đặt → Sao lưu / Khôi phục) |

## Cách hoạt động

- `scripts/build-www.mjs` chép `../web/` sang `www/`, gói `src/native-ble.js` và chèn nó trước `app.js`.
- `src/native-ble.js` dựng lại đúng phần `navigator.bluetooth` mà `web/app.js` dùng bằng Bluetooth gốc, nên **không sửa gì trong web/**.
  Sửa giao diện: sửa `web/` rồi build lại app.

## Build lại APK (Windows)

Cần: Node 20+, JDK 21, Android SDK (có sẵn khi cài Android Studio).

```powershell
cd android-app
npm install
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# Java trên máy này không tạo được "ống" nội bộ trong TEMP -> chỉ thư mục tạm khác (lỗi "Unable to establish loopback connection")
New-Item -ItemType Directory -Force .tmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=`"$PWD\.tmp`""
npm run apk
Copy-Item android\app\build\outputs\apk\debug\app-debug.apk RehabBoardAI.apk
```

Đổi icon: `python scripts/make_icons.py` (Pillow + font Segoe UI Emoji) rồi build lại.
