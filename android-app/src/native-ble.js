// RehabBoard AI — lớp nối app Android với giao diện web (web/app.js giữ nguyên, không sửa).
//
// WebView của Android KHÔNG có Web Bluetooth (navigator.bluetooth) như Chrome. File này dựng lại đúng phần
// navigator.bluetooth mà web/app.js dùng (requestDevice, gatt.connect, getPrimaryService, getCharacteristic,
// startNotifications, sự kiện characteristicvaluechanged / gattserverdisconnected, writeValue) bằng
// Bluetooth LE gốc của Android (plugin @capacitor-community/bluetooth-le).
//
// Ngoài ra:
//   - lời gọi fetch("/api/...") (Trợ lý AI) chuyển về trang Vercel; CapacitorHttp gửi bằng mạng gốc nên không vướng CORS
//   - ẩn nút "USB": điện thoại không có Web Serial / cổng COM như máy tính
import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

const API_BASE = "https://hethongtapluyen.vercel.app";

if (Capacitor.isNativePlatform()) {
  // ---------------------------------------------------------------- Trợ lý AI: /api/... -> Vercel
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/")) input = API_BASE + input;
    return origFetch(input, init);
  };

  // ---------------------------------------------------------------- giao diện: ẩn nút USB, chừa chỗ thanh hệ thống
  // Android 15 vẽ app tràn mép: Capacitor đưa kích thước thanh trạng thái / điều hướng vào --safe-area-inset-*.
  const T = "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))";
  const B = "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))";
  const style = document.createElement("style");
  style.textContent = `
    .btn-usb{display:none!important}
    html.native-app .side{padding-top:calc(18px + ${T})}
    html.native-app main{padding-bottom:calc(40px + ${B})}
    @media (min-width:821px){html.native-app main{padding-top:calc(18px + ${T})}}
    @media (max-width:820px){html.native-app .side{padding-top:calc(10px + ${T})}html.native-app main{padding-bottom:calc(30px + ${B})}}
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add("native-app");
  // chữ/biểu tượng thanh trạng thái màu sáng (nằm trên menu xanh đậm), thanh điều hướng màu tối (nền sáng)
  SystemBars.setStyle({ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar }).catch(() => {});
  SystemBars.setStyle({ style: SystemBarsStyle.Light, bar: SystemBarType.NavigationBar }).catch(() => {});

  // ---------------------------------------------------------------- Bluetooth LE gốc, giả lập Web Bluetooth
  let ready = null;
  const init = () => (ready ??= BleClient.initialize({ androidNeverForLocation: true }).catch((e) => { ready = null; throw e; }));

  const toDataView = (v) =>
    v instanceof DataView ? v : ArrayBuffer.isView(v) ? new DataView(v.buffer, v.byteOffset, v.byteLength) : new DataView(v);

  /** lỗi mang tên như Web Bluetooth: app.js im lặng khi người dùng bấm Huỷ (NotFoundError) */
  const webError = (e) => {
    const msg = (e && e.message) || String(e);
    const err = new Error(/cancel/i.test(msg) ? "Đã huỷ chọn thiết bị" : msg);
    err.name = /cancel/i.test(msg) ? "NotFoundError" : "NetworkError";
    return err;
  };

  class Characteristic extends EventTarget {
    constructor(device, service, uuid) {
      super();
      Object.assign(this, { device, service, uuid, value: null });
    }
    async startNotifications() {
      await BleClient.startNotifications(this.device.id, this.service, this.uuid, (dv) => {
        this.value = dv;
        this.dispatchEvent(new Event("characteristicvaluechanged")); // e.target === this -> e.target.value
      });
      return this;
    }
    async stopNotifications() {
      await BleClient.stopNotifications(this.device.id, this.service, this.uuid);
      return this;
    }
    async writeValue(v) {
      await BleClient.write(this.device.id, this.service, this.uuid, toDataView(v));
    }
    writeValueWithResponse(v) { return this.writeValue(v); }
    async writeValueWithoutResponse(v) {
      await BleClient.writeWithoutResponse(this.device.id, this.service, this.uuid, toDataView(v));
    }
    async readValue() {
      this.value = await BleClient.read(this.device.id, this.service, this.uuid);
      return this.value;
    }
  }

  class Service {
    constructor(device, uuid) { Object.assign(this, { device, uuid }); }
    async getCharacteristic(uuid) { return new Characteristic(this.device, this.uuid, uuid.toLowerCase()); }
  }

  class Gatt {
    constructor(device) { this.device = device; this.connected = false; }
    async connect() {
      await init();
      try {
        await BleClient.connect(this.device.id, () => {
          this.connected = false;
          this.device.dispatchEvent(new Event("gattserverdisconnected"));
        }, { timeout: 15000 });
      } catch (e) { throw webError(e); }
      this.connected = true;
      return this;
    }
    disconnect() {
      this.connected = false;
      BleClient.disconnect(this.device.id).catch(() => {});
    }
    async getPrimaryService(uuid) { return new Service(this.device, uuid.toLowerCase()); }
  }

  class Device extends EventTarget {
    constructor(d) {
      super();
      this.id = d.deviceId;
      this.name = d.name || "REHABBOARD";
      this.gatt = new Gatt(this);
    }
  }

  const bluetooth = {
    async getAvailability() {
      try { await init(); return await BleClient.isEnabled(); } catch { return false; }
    },
    async requestDevice(opts = {}) {
      try {
        await init();
        if (!(await BleClient.isEnabled())) await BleClient.requestEnable(); // hỏi bật Bluetooth điện thoại
        // Web: filters là HOẶC; plugin gộp thành VÀ -> lọc theo UUID dịch vụ (board phát trong gói quảng bá)
        const services = [...new Set((opts.filters || []).flatMap((f) => f.services || []))].map((s) => s.toLowerCase());
        const namePrefix = services.length ? undefined : (opts.filters || []).map((f) => f.namePrefix).find(Boolean);
        const d = await BleClient.requestDevice({
          services: services.length ? services : undefined,
          namePrefix,
          optionalServices: (opts.optionalServices || []).map((s) => s.toLowerCase()),
        });
        return new Device(d);
      } catch (e) { throw webError(e); }
    },
  };

  Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
}
