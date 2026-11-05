"""REHABBOARD AI — web theo dõi luyện tập phục hồi bàn tay + trợ lý AI (OpenAI).

    python WebApp/server.py            # đọc board qua cổng USB (tự tìm cổng có firmware REHABBOARD_WEB)
    python WebApp/server.py --demo     # chỉ để phát triển giao diện: bệnh nhân ảo, KHÔNG dùng khi tập thật
    Mở: http://localhost:8095

Board phải chạy Firmwave/REHABBOARD_WEB (gửi JSON 20 lần/giây, nhận lệnh TARE/BEEP/LED...).
Cấu hình: WebApp/config.json (tự tạo). Khoá OpenAI: biến môi trường OPENAI_API_KEY hoặc trang Cài đặt.
Dữ liệu người tập: WebApp/data/rehab.db (SQLite).
"""
import argparse
import asyncio
import json
import math
import random
import sqlite3
import threading
import time
from collections import deque
from pathlib import Path

import serial
from serial.tools import list_ports
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import sys

for _s in (sys.stdout, sys.stderr):  # cửa sổ lệnh Windows (cp1252) không in được tiếng Việt
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)
CONFIG_PATH = HERE / "config.json"
DB_PATH = DATA / "rehab.db"

USB_VIDS = {0x1A86, 0x303A, 0x10C4, 0x0403}  # CH343/CH340, ESP32-S3 USB gốc, CP210x, FTDI
CHANNELS = ["N1", "N2", "N3", "N4", "N5", "BOP"]

DEFAULT_CONFIG = {
    "host": "127.0.0.1",          # đổi thành "0.0.0.0" để máy tính bảng cùng Wi-Fi mở được
    "port": 8095,
    "serial_port": "auto",        # hoặc "COM9"
    "openai_api_key": "",         # để trống nếu dùng biến môi trường OPENAI_API_KEY
    "openai_model": "gpt-5.5-mini",
    # Hiệu chuẩn: số đếm HX711 ứng với 1 kg cho từng kênh (null = chưa hiệu chuẩn -> đơn vị tương đối)
    "counts_per_kg": [None, None, None, None, None, None],
    # Mục tiêu để chấm điểm (số đếm HX711, đo trên board 05/11/2026: ngón ~5-7k, bóp tay ~70k)
    "target_finger_counts": 8000,
    "target_grip_counts": 60000,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            print("config.json lỗi, dùng mặc định:", e)
    return cfg


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


CFG = load_config()
CFG.pop("demo", None)  # chế độ mô phỏng chỉ bật bằng tham số --demo, không lưu trong cấu hình
if not CONFIG_PATH.exists():
    save_config(CFG)
DEMO = False  # main() đặt True khi chạy với --demo


# ------------------------------------------------------------------ cơ sở dữ liệu
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS patients(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, birth_year INTEGER, gender TEXT,
            hand TEXT DEFAULT 'phai', diagnosis TEXT, notes TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, exercise TEXT NOT NULL,
            started REAL, ended REAL, score REAL, metrics TEXT, demo INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS ai_reports(
            id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, created REAL, model TEXT,
            kind TEXT, question TEXT, text TEXT);
        """)


init_db()


# ------------------------------------------------------------------ trung tâm phát dữ liệu (SSE)
class Hub:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame = None
        self.frame_seq = 0
        self.events = deque(maxlen=300)
        self.event_seq = 0
        self.status = {"connected": False, "port": None, "demo": False, "message": "Đang khởi động",
                       "hx": None, "boot": None}

    def put_frame(self, f):
        with self.lock:
            self.frame = f
            self.frame_seq += 1

    def put_event(self, e):
        with self.lock:
            self.event_seq += 1
            self.events.append((self.event_seq, e))

    def set_status(self, **kw):
        with self.lock:
            self.status.update(kw)

    def snapshot(self, last_event):
        with self.lock:
            evs = [e for s, e in self.events if s > last_event]
            return self.frame, self.frame_seq, evs, self.event_seq, dict(self.status)


HUB = Hub()


# ------------------------------------------------------------------ mô phỏng (không cần board)
class Simulator:
    """Bệnh nhân ảo: ngón 4 yếu, phản xạ 350–800 ms. Web gửi lệnh SIM ... để bệnh nhân ảo làm theo bài tập."""

    STRENGTH = [7500, 6800, 7200, 3900, 5200, 52000]

    def __init__(self):
        self.force = [0.0] * 6
        self.press = {}           # kênh -> (bắt đầu, kết thúc)
        self.enc = 0.0
        self.enc_target = None
        self.pot = 0.0
        self.pot_target = None
        self.leds = [0, 0, 0, 0]
        self.pending_press = None  # (thời điểm, nút)
        self.g = [0, 0, 0, 0]
        self.g_release = [0.0] * 4
        self.b9 = 0
        self.t0 = time.time()

    def command(self, c):
        p = c.strip().upper().split()
        if not p:
            return
        now = time.time()
        if p[0] == "LED" and len(p) == 3:
            i, v = int(p[1]) - 1, int(p[2])
            self.leds[i] = v
            if v:
                wrong = random.random() < 0.08
                btn = random.choice([k for k in range(4) if k != i]) if wrong else i
                self.pending_press = (now + random.uniform(0.35, 0.8), btn)
        elif p[0] == "TARE":
            HUB.put_event({"ev": "tare", "state": "start"})
            HUB.put_event({"ev": "tare", "state": "done"})
        elif p[0] == "ENC0":
            self.enc = 0
        elif p[0] == "SIM" and len(p) >= 2:
            if p[1] == "PRESS" and len(p) >= 4:      # SIM PRESS <kênh 0-5> <ms>
                ch, ms = int(p[2]), int(p[3])
                self.press[ch] = (now + random.uniform(0.3, 0.7), now + ms / 1000)
            elif p[1] == "ROT" and len(p) >= 3:      # SIM ROT <mục tiêu>
                self.enc_target = float(p[2])
            elif p[1] == "POT" and len(p) >= 3:      # SIM POT <0-100>
                self.pot_target = float(p[2]) / 100 * 4095
        HUB.put_event({"ack": p[0]})

    def step(self):
        now = time.time()
        for ch in range(6):
            target = 0.0
            if ch in self.press:
                a, b = self.press[ch]
                if a <= now <= b:
                    fatigue = 1 - 0.15 * min(1, (now - a) / 3)
                    target = self.STRENGTH[ch] * fatigue * (1 + 0.05 * math.sin(now * 9))
                    # ngón bên cạnh bị kéo theo (giảm khả năng tách ngón)
                elif now > b:
                    del self.press[ch]
            self.force[ch] += (target - self.force[ch]) * 0.25
        for ch in range(5):  # tách ngón chưa tốt: kênh kế bên nhận 12 %
            for nb in (ch - 1, ch + 1):
                if 0 <= nb < 5 and nb in self.press and ch not in self.press:
                    self.force[ch] = max(self.force[ch], self.force[nb] * 0.12)
        if self.enc_target is not None:
            d = self.enc_target - self.enc
            self.enc += max(-0.6, min(0.6, d * 0.15)) + random.uniform(-0.05, 0.05)
        if self.pot_target is not None:
            self.pot += (self.pot_target - self.pot) * 0.12 + random.uniform(-25, 25)
            self.pot = max(0, min(4095, self.pot))
        if self.pending_press and now >= self.pending_press[0]:
            btn = self.pending_press[1]
            self.pending_press = None
            self.g[btn] = 1
            self.g_release[btn] = now + 0.18
            HUB.put_event({"ev": "game", "i": btn + 1, "v": 1, "t": int((now - self.t0) * 1000)})
        for k in range(4):
            if self.g[k] and now >= self.g_release[k]:
                self.g[k] = 0
                HUB.put_event({"ev": "game", "i": k + 1, "v": 0, "t": int((now - self.t0) * 1000)})
        noise = [random.uniform(-60, 60) for _ in range(6)]
        return {"t": int((now - self.t0) * 1000),
                "f": [int(self.force[i] * (-1 if i == 2 else 1) + noise[i]) for i in range(6)],
                "enc": int(round(self.enc)), "sw": 0, "pot": int(self.pot), "b9": self.b9,
                "g": list(self.g), "hx": 6}


# ------------------------------------------------------------------ đọc board qua USB
class Board:
    def __init__(self):
        self.ser = None
        self.lock = threading.Lock()
        self.sim = None
        self.stop = False

    def write(self, cmd):
        if self.sim:
            self.sim.command(cmd)
            return True
        with self.lock:
            if not self.ser:
                return False
            try:
                self.ser.write((cmd.strip() + "\n").encode())
                return True
            except serial.SerialException:
                return False

    def _probe(self, dev):
        s = serial.Serial()
        s.port, s.baudrate, s.timeout = dev, 115200, 0.2
        s.dtr = s.rts = False
        try:
            s.open()
        except serial.SerialException:
            return None, "bận"
        end = time.time() + 2.5
        buf = b""
        while time.time() < end:
            buf += s.read(s.in_waiting or 1)
            if b'{"t":' in buf or b'{"boot"' in buf:
                return s, "ok"
        s.close()
        return None, "không phải REHABBOARD_WEB"

    def _find(self):
        pref = str(CFG.get("serial_port", "auto"))
        if pref.lower() != "auto":
            cands = [pref]
        else:
            cands = [p.device for p in list_ports.comports() if p.vid in USB_VIDS]
        notes = []
        for dev in cands:
            s, why = self._probe(dev)
            if s:
                return s, dev, ""
            notes.append(f"{dev}: {why}")
        if not cands:
            return None, None, "Không thấy cổng USB nào của board"
        return None, None, "; ".join(notes)

    def run(self):
        while not self.stop:
            if DEMO:
                self._run_demo()
                continue
            s, dev, why = self._find()
            if not s:
                HUB.set_status(connected=False, port=None, demo=False,
                               message=f"Chưa kết nối board ({why}). Nạp Firmwave/REHABBOARD_WEB, "
                                       f"đóng Arduino IDE/Serial Monitor.")
                for _ in range(30):
                    if self.stop or DEMO:
                        break
                    time.sleep(0.1)
                continue
            with self.lock:
                self.ser = s
            HUB.set_status(connected=True, port=dev, demo=False, message=f"Đã kết nối board ({dev})")
            HUB.put_event({"ev": "connected", "port": dev})
            buf = b""
            last_rx = time.time()
            try:
                while not self.stop and not DEMO:
                    # đọc ngay phần đang có (read(4096) trên Windows chờ đủ 4096 byte ~2 s mới trả về)
                    chunk = s.read(s.in_waiting or 1)
                    if chunk:
                        last_rx = time.time()
                        buf += chunk
                    elif time.time() - last_rx > 3:
                        raise serial.SerialException("board không gửi dữ liệu 3 s")
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        self._handle(line.decode("utf-8", "replace").strip())
            except (serial.SerialException, OSError) as e:
                HUB.set_status(connected=False, message=f"Mất kết nối board: {e}")
                HUB.put_event({"ev": "disconnected"})
            finally:
                with self.lock:
                    self.ser = None
                try:
                    s.close()
                except Exception:  # noqa: BLE001
                    pass

    def _handle(self, line):
        if not line.startswith("{"):
            return
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            return
        if "t" in obj and "f" in obj:
            obj["rx"] = time.time()
            HUB.put_frame(obj)
            HUB.set_status(hx=obj.get("hx"))
        else:
            if "boot" in obj:
                HUB.set_status(boot=obj)
            HUB.put_event(obj)

    def _run_demo(self):
        self.sim = Simulator()
        HUB.set_status(connected=True, port="MÔ PHỎNG", demo=True, hx=6,
                       message="Chế độ mô phỏng: bệnh nhân ảo (ngón 4 yếu)")
        HUB.put_event({"ev": "connected", "port": "MÔ PHỎNG"})
        while not self.stop and DEMO:
            f = self.sim.step()
            f["rx"] = time.time()
            HUB.put_frame(f)
            time.sleep(0.05)
        self.sim = None


BOARD = Board()

# ------------------------------------------------------------------ AI (OpenAI)
SYSTEM_PROMPT = """Bạn là trợ lý AI của hệ thống RehabBoard AI — thiết bị luyện tập phục hồi chức năng bàn tay theo mô-đun
(nhấn từng ngón, bóp tay, 9 lỗ — kiểu Nine-Hole Peg Test: cắm/chạm đủ 9 lỗ và bấm giờ, xoay núm, thanh trượt,
game phản xạ). Bạn hỗ trợ người tập và kỹ thuật viên phục hồi chức năng.

Nhiệm vụ: đọc số liệu các buổi tập, phân tích tiến triển và đưa ra lời khuyên tập luyện cụ thể, an toàn, dễ làm theo.
Quy tắc:
- Viết tiếng Việt, giọng động viên, câu ngắn, dễ hiểu với người lớn tuổi.
- Chỉ dựa vào số liệu được cung cấp; nói rõ khi dữ liệu còn ít hoặc có dấu hiệu lỗi cảm biến (ví dụ một ngón luôn ~0).
- Lực đo bằng load cell, nếu chưa hiệu chuẩn thì là ĐƠN VỊ TƯƠNG ĐỐI: chỉ so sánh giữa các ngón và giữa các buổi.
- Không chẩn đoán bệnh, không kê thuốc. Nhắc dừng tập khi đau, tê tăng, sưng; nên trao đổi với bác sĩ/kỹ thuật viên
  trước khi tăng cường độ.
- Đề xuất bài tập bằng chính các mô-đun của RehabBoard (số lần, thời gian giữ, mức lực mục tiêu, số buổi/tuần).
Định dạng (Markdown):
## Tóm tắt
## Điểm tiến bộ
## Cần cải thiện
## Kế hoạch tập tuần tới  (bảng: Bài tập | Cách tập | Số lần | Mục tiêu)
## Lưu ý an toàn
"""


def ai_key():
    import os
    return os.environ.get("OPENAI_API_KEY") or CFG.get("openai_api_key") or ""


def call_openai(messages, instructions=SYSTEM_PROMPT):
    key = ai_key()
    if not key:
        raise HTTPException(400, "Chưa có khoá OpenAI. Vào Cài đặt → nhập API key (hoặc đặt biến môi trường "
                                 "OPENAI_API_KEY) rồi thử lại.")
    from openai import OpenAI
    client = OpenAI(api_key=key, timeout=90)
    model = CFG.get("openai_model") or "gpt-5.5-mini"
    try:
        resp = client.responses.create(model=model, instructions=instructions, input=messages)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Lỗi gọi OpenAI (model {model}): {e}") from e
    return resp.output_text, model


def patient_context(pid, limit=40):
    with db() as con:
        p = con.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "Không tìm thấy người tập")
        rows = con.execute("SELECT * FROM sessions WHERE patient_id=? ORDER BY started DESC LIMIT ?",
                           (pid, limit)).fetchall()
    sessions = []
    for r in reversed(rows):
        sessions.append({"bai_tap": r["exercise"], "ngay": time.strftime("%d/%m/%Y %H:%M", time.localtime(r["started"])),
                         "diem": r["score"], "so_lieu": json.loads(r["metrics"] or "{}"),
                         "mo_phong": bool(r["demo"])})
    calibrated = [c is not None for c in CFG.get("counts_per_kg", [])]
    return {
        "nguoi_tap": {"ten": p["name"], "nam_sinh": p["birth_year"], "gioi_tinh": p["gender"],
                      "tay_tap": "trái" if p["hand"] == "trai" else "phải", "chan_doan": p["diagnosis"],
                      "ghi_chu": p["notes"]},
        "don_vi_luc": "kg" if all(calibrated) else "tương đối (số đếm HX711 / 1000, chưa hiệu chuẩn)",
        "buoi_tap": sessions,
    }


# ------------------------------------------------------------------ API
app = FastAPI(title="RehabBoard AI")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/stream")
async def stream():
    async def gen():
        last_frame_seq, last_event = -1, HUB.event_seq
        last_status = None
        while True:
            frame, fseq, evs, eseq, status = HUB.snapshot(last_event)
            last_event = eseq
            out = []
            for e in evs:
                out.append(f"event: ev\ndata: {json.dumps(e, ensure_ascii=False)}\n\n")
            st = json.dumps(status, ensure_ascii=False)
            if st != last_status:
                out.append(f"event: status\ndata: {st}\n\n")
                last_status = st
            if frame is not None and fseq != last_frame_seq:
                last_frame_seq = fseq
                out.append(f"event: frame\ndata: {json.dumps(frame)}\n\n")
            if out:
                yield "".join(out)
            else:
                yield ": keepalive\n\n" if random.random() < 0.02 else ""
            await asyncio.sleep(0.05)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


ALLOWED_CMDS = ("TARE", "BEEP", "LED", "LEDS AUTO", "ENC0", "PING", "SIM")


@app.post("/api/cmd")
def cmd(body: dict):
    c = str(body.get("cmd", "")).strip().upper()
    if not c.startswith(ALLOWED_CMDS):
        raise HTTPException(400, "Lệnh không hợp lệ")
    if c.startswith("SIM") and not DEMO:
        return {"ok": True, "ignored": True}
    return {"ok": BOARD.write(c)}


@app.get("/api/status")
def status():
    _, _, _, _, st = HUB.snapshot(10 ** 12)
    st.update(ai_ready=bool(ai_key()), model=CFG.get("openai_model"),
              counts_per_kg=CFG.get("counts_per_kg"), target_finger_counts=CFG.get("target_finger_counts"),
              target_grip_counts=CFG.get("target_grip_counts"))
    return st


# ---- người tập
@app.get("/api/patients")
def patients():
    with db() as con:
        rows = con.execute("""SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.patient_id=p.id) AS n_sessions,
                              (SELECT MAX(started) FROM sessions s WHERE s.patient_id=p.id) AS last_session
                              FROM patients p ORDER BY p.name""").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/patients")
def add_patient(body: dict):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Cần nhập tên")
    with db() as con:
        cur = con.execute("INSERT INTO patients(name,birth_year,gender,hand,diagnosis,notes,created) VALUES(?,?,?,?,?,?,?)",
                          (name, body.get("birth_year") or None, body.get("gender"), body.get("hand", "phai"),
                           body.get("diagnosis"), body.get("notes"), time.time()))
        return {"id": cur.lastrowid}


@app.put("/api/patients/{pid}")
def edit_patient(pid: int, body: dict):
    with db() as con:
        con.execute("UPDATE patients SET name=?,birth_year=?,gender=?,hand=?,diagnosis=?,notes=? WHERE id=?",
                    (body.get("name"), body.get("birth_year") or None, body.get("gender"), body.get("hand", "phai"),
                     body.get("diagnosis"), body.get("notes"), pid))
    return {"ok": True}


@app.delete("/api/patients/{pid}")
def delete_patient(pid: int):
    with db() as con:
        con.execute("DELETE FROM sessions WHERE patient_id=?", (pid,))
        con.execute("DELETE FROM ai_reports WHERE patient_id=?", (pid,))
        con.execute("DELETE FROM patients WHERE id=?", (pid,))
    return {"ok": True}


# ---- buổi tập
@app.post("/api/sessions")
def add_session(body: dict):
    pid = int(body.get("patient_id") or 0)
    if not pid:
        raise HTTPException(400, "Chưa chọn người tập")
    with db() as con:
        cur = con.execute("INSERT INTO sessions(patient_id,exercise,started,ended,score,metrics,demo) VALUES(?,?,?,?,?,?,?)",
                          (pid, body.get("exercise"), body.get("started") or time.time(), body.get("ended") or time.time(),
                           body.get("score"), json.dumps(body.get("metrics") or {}, ensure_ascii=False),
                           1 if DEMO else 0))
        return {"id": cur.lastrowid}


@app.get("/api/patients/{pid}/sessions")
def list_sessions(pid: int):
    with db() as con:
        rows = con.execute("SELECT * FROM sessions WHERE patient_id=? ORDER BY started", (pid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["metrics"] = json.loads(d["metrics"] or "{}")
        out.append(d)
    return out


@app.delete("/api/sessions/{sid}")
def delete_session(sid: int):
    with db() as con:
        con.execute("DELETE FROM sessions WHERE id=?", (sid,))
    return {"ok": True}


# ---- AI
@app.post("/api/ai/analyze")
def ai_analyze(body: dict):
    pid = int(body.get("patient_id") or 0)
    ctx = patient_context(pid)
    if not ctx["buoi_tap"]:
        raise HTTPException(400, "Người tập chưa có buổi tập nào để phân tích")
    msg = ("Đây là hồ sơ và số liệu các buổi tập gần nhất (JSON). Hãy phân tích tiến triển và đưa lời khuyên "
           "tập luyện cho tuần tới.\n\n" + json.dumps(ctx, ensure_ascii=False))
    text, model = call_openai([{"role": "user", "content": msg}])
    with db() as con:
        cur = con.execute("INSERT INTO ai_reports(patient_id,created,model,kind,question,text) VALUES(?,?,?,?,?,?)",
                          (pid, time.time(), model, "phan_tich", None, text))
    return {"id": cur.lastrowid, "text": text, "model": model, "created": time.time()}


@app.post("/api/ai/chat")
def ai_chat(body: dict):
    pid = int(body.get("patient_id") or 0)
    history = body.get("messages") or []
    if not history or history[-1].get("role") != "user":
        raise HTTPException(400, "Thiếu câu hỏi")
    ctx = patient_context(pid, limit=20)
    msgs = [{"role": "user", "content": "Số liệu người tập (JSON) để bạn tham khảo khi trả lời:\n"
                                        + json.dumps(ctx, ensure_ascii=False)},
            {"role": "assistant", "content": "Tôi đã đọc số liệu. Bạn muốn hỏi gì?"}]
    for m in history[-12:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": str(m["content"])[:4000]})
    instructions = SYSTEM_PROMPT.split("Định dạng")[0] + "Trả lời ngắn gọn, đúng câu hỏi, dùng Markdown khi cần."
    text, model = call_openai(msgs, instructions)
    with db() as con:
        con.execute("INSERT INTO ai_reports(patient_id,created,model,kind,question,text) VALUES(?,?,?,?,?,?)",
                    (pid, time.time(), model, "hoi_dap", history[-1]["content"], text))
    return {"text": text, "model": model}


@app.get("/api/patients/{pid}/ai")
def ai_history(pid: int):
    with db() as con:
        rows = con.execute("SELECT * FROM ai_reports WHERE patient_id=? ORDER BY created DESC LIMIT 30",
                           (pid,)).fetchall()
    return [dict(r) for r in rows]


# ---- cài đặt
@app.get("/api/settings")
def get_settings():
    key = CFG.get("openai_api_key") or ""
    import os
    return {
        "serial_port": CFG.get("serial_port"), "openai_model": CFG.get("openai_model"),
        "openai_key_set": bool(key), "openai_key_hint": (key[:3] + "…" + key[-4:]) if len(key) > 8 else "",
        "openai_key_env": bool(os.environ.get("OPENAI_API_KEY")),
        "counts_per_kg": CFG.get("counts_per_kg"), "target_finger_counts": CFG.get("target_finger_counts"),
        "target_grip_counts": CFG.get("target_grip_counts"), "host": CFG.get("host"), "port": CFG.get("port"),
        "ports": [{"device": p.device, "desc": p.description} for p in list_ports.comports()],
    }


@app.post("/api/settings")
def set_settings(body: dict):
    for k in ("serial_port", "openai_model", "target_finger_counts", "target_grip_counts", "counts_per_kg"):
        if k in body:
            CFG[k] = body[k]
    if body.get("openai_api_key"):
        CFG["openai_api_key"] = str(body["openai_api_key"]).strip()
    if body.get("clear_openai_key"):
        CFG["openai_api_key"] = ""
    save_config(CFG)
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="chỉ để phát triển: bệnh nhân ảo, không cần board")
    ap.add_argument("--port", type=int, help="cổng web (mặc định 8095)")
    ap.add_argument("--host", help="127.0.0.1 (chỉ máy này) hoặc 0.0.0.0 (cho máy tính bảng cùng mạng)")
    args = ap.parse_args()
    global DEMO
    DEMO = bool(args.demo)
    threading.Thread(target=BOARD.run, daemon=True).start()
    import uvicorn
    host = args.host or CFG.get("host", "127.0.0.1")
    port = args.port or int(CFG.get("port", 8095))
    print(f"RehabBoard AI: http://localhost:{port}  ({'MÔ PHỎNG' if DEMO else 'board USB'})")
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
