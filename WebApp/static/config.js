// Địa chỉ máy chủ (laptop cắm board, chạy WebApp/server.py).
// - Mở web ngay trên laptop (http://localhost:8095): gọi API cùng trang -> để trống.
// - Mở từ Vercel (*.vercel.app): gọi về laptop qua Tailscale Funnel (cổng 443).
//   Đổi máy chủ thì sửa TUNNEL rồi đẩy lên GitHub (Vercel tự triển khai lại).
(function () {
  var TUNNEL = "https://laptop-mfdvl03v.tailcce006.ts.net";
  window.API_BASE = /\.vercel\.app$/.test(location.hostname) ? TUNNEL : "";
})();
