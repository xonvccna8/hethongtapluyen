"""Vẽ lại sơ đồ đi dây RehabBoard AI (khớp code Firmwave/ và dây thực tế đã test 05/11/2026).

    python SoDo/ve_so_do_ket_noi.py
-> SoDo/so_do_ket_noi.html  rồi in ra  RehabBoard_Ket_noi_v2.pdf  (A3 ngang) bằng Edge/Chrome headless.
Sửa chân / chữ ở các bảng dữ liệu bên dưới rồi chạy lại.
"""
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "SoDo" / "so_do_ket_noi.html"
PDF = ROOT / "RehabBoard_Ket_noi_v2.pdf"

W, H = 1588, 1123  # A3 ngang ở 96 dpi

C = {
    "red": "#d62828", "black": "#222222", "blue": "#1d6fd8", "yellow": "#d99a00",
    "green": "#2a9d3a", "orange": "#ef7d10", "grey": "#9aa3ad", "ink": "#1b2a3a",
    "panel": "#ffffff", "bg": "#f3f6fa", "head": "#0d4c8c", "warn": "#c62828", "chg": "#e07b00",
}

out = []


def add(s):
    out.append(s)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=11, color=None, weight=400, anchor="start", italic=False):
    st = ' font-style="italic"' if italic else ""
    add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or C["ink"]}" font-weight="{weight}" '
        f'text-anchor="{anchor}"{st}>{esc(s)}</text>')


def rect(x, y, w, h, fill, stroke="none", sw=1, rx=0, extra=""):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" '
        f'stroke-width="{sw}" {extra}/>')


def line(x1, y1, x2, y2, color, sw=1.6):
    add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>')


def circle(x, y, r, fill, stroke="none", sw=1):
    add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')


def panel(x, y, w, h, title, color=None):
    rect(x, y, w, h, C["panel"], "#c9d6e5", 1.2, 10)
    rect(x, y, w, 26, color or C["head"], rx=10)
    rect(x, y + 14, w, 12, color or C["head"])
    text(x + 12, y + 18, title, 13, "#ffffff", 700)


def pinbox(x, y, w, label, color, bold=True):
    rect(x, y - 10, w, 20, "#f7f9fc", color, 1.3, 4)
    rect(x, y - 10, 5, 20, color, rx=2)
    text(x + 11, y + 4, label, 11, C["ink"], 700 if bold else 400)


def badge(x, y, s, color):
    w = 7 * len(s) + 12
    rect(x, y - 11, w, 16, color, rx=8)
    text(x + w / 2, y + 1, s, 9.5, "#ffffff", 700, "middle")


# ---------------------------------------------------------------- ESP32-S3 board
BX, BY, BW, BH = 640, 92, 280, 650
PIN_Y0, PIN_DY = 140, 27
LEFT_PINS = ["3V3", "3V3", "RST", "4", "5", "6", "7", "15", "16", "17", "18", "8", "3", "46", "9", "10",
             "11", "12", "13", "14", "5V", "GND"]
RIGHT_PINS = ["GND", "TX", "RX", "1", "2", "42", "41", "40", "39", "38", "37", "36", "35", "0", "45", "48",
              "47", "21", "20", "19", "GND", "GND"]


def pin_y(side, name, nth=0):
    pins = LEFT_PINS if side == "L" else RIGHT_PINS
    idx = [i for i, p in enumerate(pins) if p == name][nth]
    return PIN_Y0 + idx * PIN_DY


# Nhãn chân đang dùng (bên ngoài board)
LEFT_TAGS = {
    "3V3": ("3V3 → VCC mô-đun", "red"), "5": ("GPIO5 · HX SCK", "yellow"), "6": ("GPIO6 · DT P4", "blue"),
    "7": ("GPIO7 · DT P2", "blue"), "15": ("GPIO15 · DT P3", "blue"), "16": ("GPIO16 · DT P1", "blue"),
    "17": ("GPIO17 · DT P5", "blue"), "18": ("GPIO18 · DT BÓP", "blue"), "9": ("GPIO9 · TRƯỢT", "green"),
    "10": ("GPIO10 · 9 LỖ", "blue"), "11": ("GPIO11 · ENC SW", "blue"), "12": ("GPIO12 · ENC DT", "blue"),
    "13": ("GPIO13 · ENC CLK", "blue"), "GND": ("GND chung", "black"),
}
RIGHT_TAGS = {
    "GND": ("GND chung", "black"), "42": ("GPIO42 · MISO", "blue"), "41": ("GPIO41 · SCK", "yellow"),
    "40": ("GPIO40 · MOSI", "blue"), "39": ("GPIO39 · DC", "blue"), "38": ("GPIO38 · RST", "blue"),
    "37": ("GPIO37 · CS", "blue"), "36": ("GPIO36 · NÚT 4", "blue"), "35": ("GPIO35 · NÚT 3", "blue"),
    "0": ("GPIO0 · NÚT 2", "blue"), "45": ("GPIO45 · NÚT 1", "blue"), "48": ("GPIO48 · LED4", "orange"),
    "47": ("GPIO47 · LED3", "orange"), "21": ("GPIO21 · LED2", "orange"), "20": ("GPIO20 · LED1", "orange"),
    "19": ("GPIO19 · CÒI", "orange"),
}
LTAG_X, TAG_W = 536, 96
RTAG_X = 924
L_WIRE_END, R_WIRE_END = LTAG_X, RTAG_X + TAG_W


def draw_board():
    text(BX + BW / 2, BY - 8, "ESP32-S3 DevKitC (cổng CH343 → COM9)", 13, C["ink"], 700, "middle")
    rect(BX, BY, BW, BH, "#16181d", "#000", 1, 14)
    # module WROOM
    rect(BX + 78, BY + 14, 124, 170, "#b9bec6", "#7d838c", 1.5, 4)
    rect(BX + 90, BY + 30, 100, 120, "#d6dade", "#9aa0a8", 1, 3)
    text(BX + 140, BY + 82, "ESP32-S3", 13, "#2b2f36", 700, "middle")
    text(BX + 140, BY + 100, "WROOM-1", 11, "#2b2f36", 600, "middle")
    for k in range(6):
        line(BX + 98 + k * 16, BY + 160, BX + 98 + k * 16, BY + 176, "#e2b23b", 2)
    # nút BOOT / RST, LED
    rect(BX + 96, BY + 260, 26, 18, "#2c2f36", "#555", 1, 3); text(BX + 109, BY + 292, "BOOT", 8.5, "#ccc", 600, "middle")
    rect(BX + 158, BY + 260, 26, 18, "#2c2f36", "#555", 1, 3); text(BX + 171, BY + 292, "RST", 8.5, "#ccc", 600, "middle")
    circle(BX + 140, BY + 330, 9, "#eaeaea", "#999")
    # cổng USB
    rect(BX + 70, BY + BH - 30, 52, 34, "#bfc4cb", "#7d838c", 1.5, 6)
    rect(BX + 158, BY + BH - 30, 52, 34, "#bfc4cb", "#7d838c", 1.5, 6)
    text(BX + 96, BY + BH - 36, "USB (CH343)", 8.5, "#ddd", 600, "middle")
    text(BX + 184, BY + BH - 36, "USB gốc", 8.5, "#ddd", 600, "middle")

    def pin_label(px, side, name, used):
        bx = px + 14 if side == "L" else px - 14 - 40
        if name in ("3V3", "5V"):
            fill, fg = C["red"], "#fff"
        elif name == "GND":
            fill, fg = "#000", "#fff"
        elif name in ("TX", "RX"):
            fill, fg = "#6a3fb0", "#fff"
        elif name == "RST":
            fill, fg = "#2563c4", "#fff"
        elif used:
            fill, fg = "#f2c230", "#1b1b1b"
        else:
            fill, fg = "#5c636d", "#e6e6e6"
        return bx, fill, fg

    for side, pins, tags in (("L", LEFT_PINS, LEFT_TAGS), ("R", RIGHT_PINS, RIGHT_TAGS)):
        px = BX + 16 if side == "L" else BX + BW - 16
        seen = {}
        for i, name in enumerate(pins):
            y = PIN_Y0 + i * PIN_DY
            nth = seen.get(name, 0)
            seen[name] = nth + 1
            used = name in tags and nth == 0
            bx, fill, fg = pin_label(px, side, name, used)
            rect(bx, y - 9, 40, 18, fill, rx=3)
            text(bx + 20, y + 4, name, 10.5, fg, 700, "middle")
            circle(px, y, 5.5, "#d9b44a", "#8a6d1d", 1.2)
            circle(px, y, 2.2, "#16181d")
            if used:
                label, col = tags[name]
                if side == "L":
                    line(LTAG_X + TAG_W, y, px - 5, y, C[col], 2)
                    rect(LTAG_X, y - 10, TAG_W, 20, "#ffffff", C[col], 1.6, 4)
                    text(LTAG_X + TAG_W / 2, y + 4, label, 9.6, C["ink"], 700, "middle")
                else:
                    line(px + 5, y, RTAG_X, y, C[col], 2)
                    rect(RTAG_X, y - 10, TAG_W, 20, "#ffffff", C[col], 1.6, 4)
                    text(RTAG_X + TAG_W / 2, y + 4, label, 9.6, C["ink"], 700, "middle")


# ---------------------------------------------------------------- dây nối + chọn làn ít cắt nhau
def route(w, lane):
    """w: dict(src=(x,y), pin_y, exit_x?, join_y?, side) -> danh sách điểm"""
    sx, sy = w["src"]
    end_x = L_WIRE_END if w["side"] == "L" else R_WIRE_END
    if "join_y" in w:
        pts = [(sx, sy), (w["exit_x"], sy), (w["exit_x"], w["join_y"]), (lane, w["join_y"]),
               (lane, w["pin_y"]), (end_x, w["pin_y"])]
    else:
        pts = [(sx, sy), (lane, sy), (lane, w["pin_y"]), (end_x, w["pin_y"])]
    return pts


def segments(pts):
    return [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]


def crosses(a, b):
    n = 0
    for (p1, p2) in segments(a):
        for (q1, q2) in segments(b):
            h1 = p1[1] == p2[1]
            h2 = q1[1] == q2[1]
            if h1 == h2:
                continue
            hs, vs = ((p1, p2), (q1, q2)) if h1 else ((q1, q2), (p1, p2))
            hx1, hx2 = sorted((hs[0][0], hs[1][0]))
            hy = hs[0][1]
            vx = vs[0][0]
            vy1, vy2 = sorted((vs[0][1], vs[1][1]))
            if hx1 < vx < hx2 and vy1 < hy < vy2:
                n += 1
    return n


def best_lanes(wires, lanes, tries=40000, seed=7):
    rnd = random.Random(seed)
    best, best_score = None, None
    for _ in range(tries):
        perm = lanes[:]
        rnd.shuffle(perm)
        paths = [route(w, perm[i]) for i, w in enumerate(wires)]
        score = sum(crosses(paths[i], paths[j]) for i in range(len(paths)) for j in range(i + 1, len(paths)))
        if best_score is None or score < best_score:
            best, best_score = perm, score
            if score == 0:
                break
    return best, best_score


def draw_wires(wires, lanes):
    perm, score = best_lanes(wires, lanes)
    for i, w in enumerate(wires):
        pts = route(w, perm[i])
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        add(f'<path d="{d}" fill="none" stroke="{C[w["color"]]}" stroke-width="2" stroke-linejoin="round"/>')
        circle(pts[0][0], pts[0][1], 2.6, C[w["color"]])
    return score


# ---------------------------------------------------------------- biểu tượng mô-đun
def icon_loadcell(x, y):
    rect(x, y, 112, 24, "#cfd5dd", "#8a929c", 1.2, 3)
    circle(x + 14, y + 12, 4, "#8a929c"); circle(x + 98, y + 12, 4, "#8a929c")
    rect(x + 44, y + 6, 24, 12, "#f4f0d0", "#b9b08a", 0.8, 1)


def icon_hx711(x, y, n):
    rect(x, y, 60, 46, "#1f8a4c", "#14653a", 1.2, 4)
    rect(x + 20, y + 14, 22, 16, "#1a1a1a", rx=2)
    for k in range(4):
        circle(x + 4, y + 9 + k * 9.5, 2.2, "#e8c66a")
        circle(x + 56, y + 9 + k * 9.5, 2.2, "#e8c66a")
    text(x + 30, y + 58, f"HX711 #{n}", 9.5, C["ink"], 700, "middle")


def icon_tft(x, y):
    rect(x, y, 158, 118, "#c8262a", "#8f1b1e", 1.5, 6)
    rect(x + 12, y + 10, 134, 98, "#0f1720", rx=3)
    text(x + 79, y + 52, "TFT 2.8\"", 13, "#7fd0ff", 700, "middle")
    text(x + 79, y + 70, "320 × 240 ngang", 10, "#7fd0ff", 600, "middle")
    for k in range(9):
        circle(x + 20 + k * 14, y + 113, 2, "#e8c66a")


def icon_encoder(x, y):
    rect(x, y, 84, 64, "#2d6fbf", "#1e4f8a", 1.2, 5)
    circle(x + 42, y + 30, 20, "#555b63", "#2a2e33", 1.5)
    circle(x + 42, y + 30, 11, "#20242a")
    rect(x + 39, y + 16, 6, 10, "#c9ced6", rx=1)
    for k in range(5):
        circle(x + 12 + k * 15, y + 58, 2, "#e8c66a")


def icon_slider(x, y, w=200):
    rect(x, y, w, 28, "#2b2f36", "#111", 1.2, 4)
    rect(x + 10, y + 11, w - 20, 6, "#0d0f12", rx=3)
    rect(x + w * 0.62, y - 6, 24, 40, "#1f6fd8", "#174f99", 1.2, 4)


def icon_buzzer(x, y):
    rect(x, y, 70, 52, "#2459a8", "#183e75", 1.2, 5)
    circle(x + 35, y + 24, 17, "#111", "#000")
    circle(x + 35, y + 24, 4, "#333")


def icon_button(x, y, color="#2d2d2d"):
    rect(x, y, 30, 30, "#e6e8eb", "#8d939b", 1.2, 4)
    circle(x + 15, y + 15, 9, color, "#111", 1)


def icon_led(x, y, color):
    line(x - 4, y + 10, x - 4, y + 28, "#9aa3ad", 2)
    line(x + 4, y + 10, x + 4, y + 32, "#9aa3ad", 2)
    add(f'<path d="M{x-10},{y+12} L{x-10},{y-4} A10,10 0 0 1 {x+10},{y-4} L{x+10},{y+12} Z" fill="{color}" '
        f'stroke="#555" stroke-width="1"/>')


# ---------------------------------------------------------------- vẽ
def build():
    add(f'<rect x="0" y="0" width="{W}" height="{H}" fill="{C["bg"]}"/>')
    text(18, 38, "REHABBOARD AI — SƠ ĐỒ KẾT NỐI THEO FIRMWARE (BẢN CẬP NHẬT)", 26, C["head"], 800)
    text(W - 18, 30, "Cập nhật 05/11/2026 · khớp code trong Firmwave/ và dây thực tế đã test trên board", 12.5,
         C["ink"], 600, "end")
    text(W - 18, 48, "Test tổng hợp: Firmwave/REHABBOARD_TEST_TONGHOP · thay cho RehabBoard_Ket_noi.pdf", 11.5,
         "#4a5a6a", 400, "end")

    left_wires, right_wires = [], []

    # ---- 01 load cell
    PX, PY, PW, PH = 14, 62, 446, 650
    panel(PX, PY, PW, PH, "01 · ĐO LỰC — 6 LOAD CELL / 6 HX711 (SCK chung GPIO5)")
    rows = [
        ("Phím 1 · LC1 · Ngón 1", 1, "16", ("ĐỔI: bản cũ GPIO6", C["chg"])),
        ("Phím 2 · LC2 · Ngón 2", 2, "7", None),
        ("Phím 3 · LC3 · Ngón 3", 3, "15", None),
        ("Phím 4 · LC4 · Ngón 4", 4, "6", ("ĐỔI: bản cũ GPIO16", C["chg"])),
        ("Phím 5 · LC5 · Ngón 5", 5, "17", ("LỖI: load cell không có tín hiệu", C["warn"])),
        ("Bóp tay · LC6", 6, "18", None),
    ]
    sck_pts = []
    for i, (lab, n, dt, bd) in enumerate(rows):
        y0 = 96 + i * 102
        text(PX + 14, y0 + 6, lab, 12, C["ink"], 700)
        if bd:
            badge(PX + 178, y0 + 5, bd[0], bd[1])
        icon_loadcell(PX + 14, y0 + 30)
        hx_x = PX + 190
        icon_hx711(hx_x, y0 + 18, n)
        for k, (col, nm) in enumerate((("red", "E+"), ("black", "E−"), ("green", "A+"), ("blue", "A−"))):
            yy = y0 + 27 + k * 9.5
            line(PX + 126, y0 + 36 + k * 4, PX + 150, yy, C[col], 1.6)
            line(PX + 150, yy, hx_x + 2, yy, C[col], 1.6)
            text(PX + 160, yy - 1.5, nm, 7.5, C[col], 700)
        pinbox(PX + 266, y0 + 26, 160, f"DT  → GPIO{dt}", C["warn"] if n == 5 else C["blue"])
        pinbox(PX + 266, y0 + 52, 160, "SCK → GPIO5", C["yellow"], False)
        text(PX + 266, y0 + 78, "VCC → 3V3 · GND → GND chung", 9.5, "#5a6878")
        sck_pts.append(y0 + 52)
        left_wires.append(dict(side="L", src=(PX + 426, y0 + 26), pin_y=pin_y("L", dt), color="blue"))
    # bus SCK (vàng) nối các ô SCK, rồi 1 dây về GPIO5
    line(PX + 432, sck_pts[0], PX + 432, sck_pts[-1], C["yellow"], 2.2)
    for y in sck_pts:
        line(PX + 426, y, PX + 432, y, C["yellow"], 2.2)
    left_wires.append(dict(side="L", src=(PX + 432, sck_pts[0]), pin_y=pin_y("L", "5"), color="yellow"))

    # ---- hàng dưới: 04 encoder, 05 thanh trượt, 03 mô-đun 9 lỗ (thay Kẹp ngón)
    BYR, BHR = 770, 196
    panel(14, BYR, 284, BHR, "03 · XOAY NÚM (ENCODER)")
    icon_encoder(28, BYR + 46)
    for k, (lab, pin) in enumerate((("CLK → GPIO13", "13"), ("DT  → GPIO12", "12"), ("SW  → GPIO11", "11"))):
        y = BYR + 50 + k * 26
        pinbox(126, y, 156, lab, C["blue"])
        left_wires.append(dict(side="L", src=(282, y), exit_x=304 + k * 7, join_y=746 + k * 5,
                               pin_y=pin_y("L", pin), color="blue"))
    text(28, BYR + 140, "VCC → 3V3 · GND chung", 10, "#5a6878")
    text(28, BYR + 156, "Code bật INPUT_PULLUP (kéo lên trong chip)", 10, "#5a6878")
    text(28, BYR + 176, "✓ Đã test: xoay 2 chiều + nhấn núm", 10.5, C["green"], 700)

    panel(330, BYR, 290, BHR, "04 · THANH TRƯỢT (BIẾN TRỞ)")
    icon_slider(346, BYR + 50, 256)
    pinbox(346, BYR + 106, 200, "SIG (chân giữa) → GPIO9", C["green"])
    left_wires.append(dict(side="L", src=(546, BYR + 106), exit_x=628, join_y=761, pin_y=pin_y("L", "9"),
                           color="green"))
    text(346, BYR + 136, "2 đầu cố định → 3V3 / GND · ADC1, 0–4095", 10, "#5a6878")
    text(346, BYR + 156, "Chạm GND đầu kia → luôn 0 / luôn 4095", 10, "#5a6878")
    text(346, BYR + 176, "⏳ Đã thấy 0 → 3929; cần kéo lại để xác nhận", 10.5, C["chg"], 700)

    panel(652, BYR, 922, BHR, "06 · MÔ-ĐUN 9 LỖ (mục 3 trên poster, thay Kẹp ngón) — 9 CÔNG TẮC ĐÁY LỖ SONG SONG VÀO GPIO10")
    for k in range(9):
        bx = 690 + k * 64
        icon_button(bx, BYR + 44, "#3a3a3a")
        text(bx + 15, BYR + 90, f"L{k+1}", 10, C["ink"], 700, "middle")
        line(bx + 6, BYR + 74, bx + 6, BYR + 108, C["blue"], 1.8)
        line(bx + 24, BYR + 74, bx + 24, BYR + 122, C["black"], 1.8)
    line(696, BYR + 108, 690 + 8 * 64 + 6, BYR + 108, C["blue"], 2.2)
    line(714, BYR + 122, 690 + 8 * 64 + 24, BYR + 122, C["black"], 2.2)
    text(690 + 8 * 64 + 40, BYR + 112, "← chân 1 mỗi công tắc → GPIO10", 10, C["blue"], 700)
    text(690 + 8 * 64 + 40, BYR + 126, "← chân 2 mỗi công tắc → GND", 10, C["black"], 700)
    pinbox(676, BYR + 150, 190, "L1…L9 → GPIO10 (chung)", C["blue"])
    add(f'<path d="M696,{BYR+108} L670,{BYR+108} L670,{BYR+150} L676,{BYR+150}" fill="none" '
        f'stroke="{C["blue"]}" stroke-width="2"/>')
    left_wires.append(dict(side="L", src=(676, BYR + 150), exit_x=642, join_y=766, pin_y=pin_y("L", "10"),
                           color="blue"))
    text(884, BYR + 146, "Cắm chốt / chạm vào lỗ = 1 nhịp nhấn-nhả (LOW). Web đếm 9 lần chạm + bấm giờ", 10.5,
         "#5a6878")
    text(884, BYR + 164, "Chỉ biết số lần chạm, không biết lỗ nào (muốn biết: mỗi lỗ 1 GPIO riêng)", 10, "#5a6878")
    text(884, BYR + 184, "✓ Đã test: chạm lỗ nào còi cũng kêu (cả 9 công tắc)", 10.5, C["green"], 700)

    # ---- bên phải: 02 TFT, 05 còi, 07 game
    RX0, RW = 1106, 468
    panel(RX0, 62, RW, 262, "02 · MÀN HÌNH TFT ILI9341 — SPI PHẦN CỨNG")
    # thứ tự ô theo thứ tự chân trên header -> dây không cắt nhau
    for k, (lab, pin, col) in enumerate((("MISO → GPIO42", "42", "blue"), ("SCK  → GPIO41", "41", "yellow"),
                                         ("MOSI → GPIO40", "40", "blue"), ("DC   → GPIO39", "39", "blue"),
                                         ("RST  → GPIO38", "38", "blue"), ("CS   → GPIO37", "37", "blue"))):
        y = 104 + k * 26
        pinbox(RX0 + 16, y, 150, lab, C[col])
        right_wires.append(dict(side="R", src=(RX0 + 16, y), pin_y=pin_y("R", pin), color=col))
    icon_tft(RX0 + 290, 96)
    text(RX0 + 186, 234, "Màn thực tế 320×240 NGANG (kiểu ILI9342):", 10.5, C["ink"], 700)
    text(RX0 + 186, 250, "code khai báo lại kích thước, không thì sọc nhiễu bên phải", 10, "#5a6878")
    text(RX0 + 16, 270, "VCC / LED → 3V3 (theo bo TFT) · GND chung · Cảm ứng / thẻ SD: chưa dùng", 10, "#5a6878")
    text(RX0 + 16, 288, "Vỏ hộp che ~8 px mép trên, ~25 px mép phải → giao diện vẽ trong 292×232", 10, "#5a6878")
    text(RX0 + 16, 310, "✓ Đã test: chữ tiếng Việt, bảng test tổng hợp", 10.5, C["green"], 700)

    BZ = 648
    panel(RX0, BZ, RW, 108, "05 · CÒI (BUZZER)", "#9a4d00")
    pinbox(RX0 + 16, BZ + 40, 150, "IN → GPIO19", C["orange"])
    right_wires.append(dict(side="R", src=(RX0 + 16, BZ + 40), pin_y=pin_y("R", "19"), color="orange"))
    icon_buzzer(RX0 + 386, BZ + 36)
    text(RX0 + 180, BZ + 38, "Kích MỨC THẤP: LOW = kêu, HIGH = im", 10.5, C["ink"], 700)
    text(RX0 + 180, BZ + 54, "(code cũ dùng GPIO36 — sai sơ đồ, đã sửa)", 10, "#5a6878")
    text(RX0 + 16, BZ + 76, "VCC theo mô-đun · GND chung", 10, "#5a6878")
    text(RX0 + 16, BZ + 96, "✓ Đã test: kêu khi chạm 9 lỗ, im khi thả", 10.5, C["green"], 700)

    GY = 336
    panel(RX0, GY, RW, 300, "07 · GAME PHỤC HỒI — 4 NÚT + 4 LED")
    # ô xếp theo thứ tự chân trên header (36, 35, 0, 45 / 48, 47, 21, 20) -> dây không cắt nhau
    btn_rows = (("NÚT 4 → GPIO36", "36"), ("NÚT 3 → GPIO35", "35"), ("NÚT 2 → GPIO0", "0"),
                ("NÚT 1 → GPIO45", "45"))
    led_rows = (("LED4 → GPIO48", "48"), ("LED3 → GPIO47", "47"), ("LED2 → GPIO21", "21"),
                ("LED1 → GPIO20", "20"))
    for k, (lab, pin) in enumerate(btn_rows):
        y = GY + 40 + k * 26
        pinbox(RX0 + 16, y, 150, lab, C["blue"])
        right_wires.append(dict(side="R", src=(RX0 + 16, y), pin_y=pin_y("R", pin), color="blue"))
    for k, (lab, pin) in enumerate(led_rows):
        y = GY + 154 + k * 26
        pinbox(RX0 + 16, y, 150, lab, C["orange"])
        right_wires.append(dict(side="R", src=(RX0 + 16, y), pin_y=pin_y("R", pin), color="orange"))
    led_cols = ("#f2c230", "#2f6fe0", "#e23b3b", "#2fae4a")
    for k in range(4):
        icon_button(RX0 + 196 + k * 66, GY + 32, "#1f9a3a")
        text(RX0 + 211 + k * 66, GY + 78, f"NÚT {k+1}", 9.5, C["ink"], 700, "middle")
        icon_led(RX0 + 211 + k * 66, GY + 146, led_cols[k])
        text(RX0 + 211 + k * 66, GY + 194, f"LED{k+1}", 9.5, C["ink"], 700, "middle")
    text(RX0 + 180, GY + 218, "Nút ↔ GND (INPUT_PULLUP)", 10, "#5a6878")
    text(RX0 + 180, GY + 232, "GPIO → R 220 Ω → LED → GND", 10, "#5a6878")
    text(RX0 + 180, GY + 248, "⚠ GPIO0: không giữ NÚT 2 khi cấp điện/reset", 10, C["warn"], 600)
    text(RX0 + 180, GY + 262, "⚠ GPIO45: nút nối GND, không nối 3V3", 10, C["warn"], 600)
    text(RX0 + 180, GY + 276, "⚠ GPIO20 = USB gốc: không cắm cổng USB gốc", 10, C["warn"], 600)
    text(RX0 + 16, GY + 292, "✓ Đã test: 4 nút · ⏳ 4 LED: chờ xác nhận bằng mắt", 10.5, C["green"], 700)

    # ---- dây
    left_lanes = [470 + k * 5.4 for k in range(len(left_wires))]
    right_lanes = [1028 + k * 5 for k in range(len(right_wires))]
    sl = draw_wires(left_wires, left_lanes)
    sr = draw_wires(right_wires, right_lanes)
    draw_board()

    # ---- chân trang
    FY = 980
    rect(14, FY, 520, 128, C["panel"], "#c9d6e5", 1.2, 10)
    text(28, FY + 22, "MÀU DÂY", 13, C["head"], 800)
    for k, (col, lab) in enumerate((("red", "Đỏ = 3V3 / E+"), ("black", "Đen = GND / E−"),
                                    ("blue", "Xanh dương = tín hiệu số / A−"), ("yellow", "Vàng = clock (SCK)"),
                                    ("green", "Xanh lá = ADC / A+"), ("orange", "Cam = ngõ ra (còi, LED)"))):
        cx = 28 + (k % 2) * 250
        cy = FY + 46 + (k // 2) * 26
        line(cx, cy, cx + 34, cy, C[col], 4)
        text(cx + 44, cy + 4, lab, 11.5, C["ink"], 600)

    rect(548, FY, 500, 128, C["panel"], "#c9d6e5", 1.2, 10)
    text(562, FY + 22, "THAY ĐỔI SO VỚI BẢN CŨ", 13, C["chg"], 800)
    for k, s in enumerate((
            "1. Phím 1 = GPIO16, Phím 4 = GPIO6 (dây thực tế bị đổi chỗ so với bản cũ)",
            "2. Còi: GPIO19, kích mức thấp (code cũ để GPIO36 — trùng NÚT 4 game)",
            "3. Đủ 6 HX711 (bản code cũ chỉ đọc 5, thiếu Bóp tay GPIO18)",
            "4. Mô-đun 9 lỗ (thay Kẹp ngón): 9 công tắc song song GPIO10 · Encoder kéo lên trong chip",
            "5. TFT là màn 320×240 ngang, chạy SPI phần cứng trên đúng các chân cũ")):
        text(562, FY + 44 + k * 17, s, 10.6, C["ink"])

    rect(1062, FY, 512, 128, C["panel"], "#c9d6e5", 1.2, 10)
    text(1076, FY + 22, "TÌNH TRẠNG TEST TRÊN BOARD (05/11/2026)", 13, C["head"], 800)
    for k, (s, col) in enumerate((
            ("✓ TFT · Encoder · 9 lỗ + còi · 4 nút game · Phím 1–4 · Bóp tay", C["green"]),
            ("⚠ Phím 5: HX711 #5 có dữ liệu nhưng load cell không có tín hiệu", C["warn"]),
            ("    → đo E+/E− (~3 V) và điện trở đỏ–đen, xanh–trắng (~1 kΩ)", C["warn"]),
            ("⏳ Thanh trượt, 4 LED: cần xác nhận lại bằng tay / bằng mắt", C["chg"]),
            ("• Mục 3 trên poster đổi từ Kẹp ngón sang mô-đun 9 lỗ (GPIO10)", "#5a6878"))):
        text(1076, FY + 44 + k * 17, s, 10.6, col, 600)
    return sl, sr


def main():
    sl, sr = build()
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="420mm" height="297mm" '
           f'font-family="Segoe UI, Arial, sans-serif">' + "".join(out) + "</svg>")
    html = ("<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Sơ đồ kết nối RehabBoard AI</title>"
            "<style>@page{size:420mm 297mm;margin:0}html,body{margin:0;padding:0;background:#fff}"
            "svg{display:block}</style></head><body>" + svg + "</body></html>")
    HTML.write_text(html, encoding="utf-8")
    print(f"HTML: {HTML}  (giao cat day: trai {sl}, phai {sr})")

    browsers = [Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
                Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")]
    exe = next((b for b in browsers if b.exists()), None)
    if not exe:
        sys.exit("Khong tim thay Edge/Chrome de in PDF")
    subprocess.run([str(exe), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={PDF}", HTML.as_uri()], check=True, timeout=120,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"PDF : {PDF}  ({PDF.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
