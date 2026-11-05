/* RehabBoard AI — giao diện web */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = avg(a); return a.length ? Math.sqrt(avg(a.map((x) => (x - m) ** 2))) : 0; };

const S = {
  frame: null, status: {}, settings: null, patients: [], pid: null, sessions: [], ai: [],
  evListeners: new Set(), frames: 0, chat: {},
};

const FINGERS = ["Ngón cái", "Ngón trỏ", "Ngón giữa", "Ngón áp út", "Ngón út"];
const LED_COLORS = ["#f2c230", "#2f6fe0", "#e23b3b", "#2fae4a"];

const EX = {
  finger: { n: 1, key: "finger", title: "Nhấn từng ngón", ico: "☝️", c: "var(--ex1)", desc: "Đo lực và khả năng điều khiển từng ngón." },
  grip: { n: 2, key: "grip", title: "Bóp tay", ico: "✊", c: "var(--ex2)", desc: "Đo lực nắm tổng thể của bàn tay." },
  holes: { n: 3, key: "holes", title: "9 lỗ", ico: "🎯", c: "var(--ex3)", desc: "Cắm chốt (hoặc chạm ngón) lần lượt vào 9 lỗ — tập vận động tinh và phối hợp ngón tay." },
  rotate: { n: 4, key: "rotate", title: "Xoay núm", ico: "🎛️", c: "var(--ex4)", desc: "Tập cổ tay và khả năng phối hợp." },
  slider: { n: 5, key: "slider", title: "Thanh trượt", ico: "🎚️", c: "var(--ex5)", desc: "Luyện kiểm soát chuyển động." },
  game: { n: 6, key: "game", title: "Game phục hồi", ico: "🎮", c: "var(--ex6)", desc: "Tăng hứng thú khi luyện tập — phản xạ 4 nút." },
};
const ACTIVE_EX = ["finger", "grip", "holes", "rotate", "slider", "game"];

// ------------------------------------------------------------------ tiện ích
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

const API = window.API_BASE || "";
const token = () => { try { return localStorage.getItem("rb_token") || ""; } catch { return ""; } };

function showLogin(msg) {
  $("#login").classList.remove("hidden");
  $("#loginErr").textContent = msg || "";
  setTimeout(() => $("#loginPw").focus(), 50);
}

async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: {} };
  if (token()) o.headers["X-RB-Token"] = token();
  if (opts.body !== undefined) { o.method = opts.method || "POST"; o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(API + path, o); }
  catch { throw new Error(API ? "Không kết nối được máy tính cắm board (máy tắt, mất mạng hoặc chưa chạy server.py)" : "Mất kết nối tới server"); }
  let data = null;
  try { data = await r.json(); } catch { /* bỏ qua */ }
  if (r.status === 401 && data && data.login) { showLogin(); throw new Error("Cần đăng nhập"); }
  if (!r.ok) throw new Error((data && data.detail) || `Lỗi ${r.status}`);
  return data;
}

const cmd = (c) => api("/api/cmd", { body: { cmd: c } }).catch((e) => toast(e.message));

function fingerNames() {
  const p = S.patients.find((x) => x.id === S.pid);
  return p && p.hand === "trai" ? [...FINGERS].reverse() : FINGERS;
}
function chName(i) { return i === 5 ? "Bóp tay" : `${fingerNames()[i]}`; }

function forceOf(frame, ch) {
  const v = frame && frame.f ? frame.f[ch] : null;
  return v == null ? 0 : Math.abs(v);
}
// nhiễu HX711 khi không chạm ~±300 số đếm: không hiển thị (vẫn dùng số thật để tính điểm)
const NOISE = 300;
const shown = (v) => (v < NOISE ? 0 : v);
function cpk(ch) { const a = S.settings?.counts_per_kg; return a && a[ch] ? Number(a[ch]) : null; }
function allCalibrated() { return [0, 1, 2, 3, 4, 5].every((i) => cpk(i)); }
function fmtForce(counts, ch) {
  const k = cpk(ch);
  return k ? `${(counts / k).toFixed(2)} kg` : `${(counts / 1000).toFixed(1)}k`;
}
function unitLabel() { return allCalibrated() ? "kg" : "đơn vị tương đối (nghìn số đếm)"; }
function toUnit(counts, ch) { const k = cpk(ch); return k ? counts / k : counts / 1000; }

function fmtDate(ts, withTime = true) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}${withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : `/${d.getFullYear()}`}`;
}
const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ------------------------------------------------------------------ Markdown đơn giản (cho câu trả lời AI)
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1<i>$2</i>");
  const lines = String(src || "").split(/\r?\n/);
  let html = "", list = null, i = 0;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:-|]+\|\s*$/.test(r));
      html += "<table>" + body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("") + "</table>";
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { closeList(); const n = Math.min(3, m[1].length + 1); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if (l.trim() === "") closeList();
    else { closeList(); html += `<p>${inline(l)}</p>`; }
    i++;
  }
  closeList();
  return html;
}

// ------------------------------------------------------------------ biểu đồ SVG nhỏ gọn
function lineChart(el, series, opt = {}) {
  const W = opt.w || 560, H = opt.h || 220, L = 40, R = 12, T = 14, B = 30;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) { el.innerHTML = `<p class="muted small">${opt.empty || "Chưa có dữ liệu."}</p>`; return; }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 3600; x1 += 3600; }
  let y0 = opt.ymin ?? Math.min(0, ...ys), y1 = opt.ymax ?? Math.max(...ys) * 1.1;
  if (y1 <= y0) y1 = y0 + 1;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const yv = y0 + ((y1 - y0) * k) / 4, yy = Y(yv);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e6eef7"/><text x="${L - 6}" y="${yy + 4}" font-size="11" text-anchor="end" fill="#6a7f95">${opt.fmt ? opt.fmt(yv) : Math.round(yv)}</text>`;
  }
  const ticks = [...new Set(xs)].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(ticks.length / 6));
  ticks.filter((_, k) => k % step === 0).forEach((x) => { g += `<text x="${X(x)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#6a7f95">${fmtDate(x, false).slice(0, 5)}</text>`; });
  for (const s of series) {
    if (!s.points.length) continue;
    const sorted = [...s.points].sort((a, b) => a.x - b.x);
    const d = sorted.map((p, k) => `${k ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
    if (opt.area && series.length === 1) g += `<path d="${d} L${X(sorted.at(-1).x)},${Y(y0)} L${X(sorted[0].x)},${Y(y0)} Z" fill="${s.color}" opacity=".12"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linejoin="round"/>`;
    g += sorted.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.6" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${esc(s.name)}: ${opt.fmt ? opt.fmt(p.y) : Math.round(p.y)} — ${fmtDate(p.x)}</title></circle>`).join("");
  }
  const legend = series.length > 1 ? `<div class="small" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">${series.map((s) => `<span><span style="display:inline-block;width:12px;height:4px;background:${s.color};border-radius:2px;vertical-align:middle"></span> ${esc(s.name)}</span>`).join("")}</div>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>${legend}`;
}

// ------------------------------------------------------------------ luồng dữ liệu trực tiếp (SSE)
function connectStream() {
  if (S.es) S.es.close();
  const es = new EventSource(API + "/api/stream" + (token() ? `?token=${encodeURIComponent(token())}` : ""));
  S.es = es;
  es.addEventListener("frame", (e) => { S.frame = JSON.parse(e.data); S.frames++; scheduleLive(); });
  es.addEventListener("ev", (e) => {
    const ev = JSON.parse(e.data);
    S.evListeners.forEach((f) => f(ev));
    if (ev.ev === "tare" && ev.state === "done") toast("✔ Đã đặt 0 cho 6 load cell");
  });
  es.addEventListener("status", (e) => { S.status = JSON.parse(e.data); renderConn(); });
  es.onerror = () => { S.status = { connected: false, message: API ? "Không nối được về máy tính cắm board" : "Mất kết nối tới server" }; renderConn(); };
}
setInterval(() => { $("#liveHz").textContent = S.frames ? `${S.frames} khung/giây` : ""; S.frames = 0; }, 1000);

function renderConn() {
  const st = S.status, c = $("#conn");
  if ($("#stBoard")) $("#stBoard").classList.toggle("done", !!st.connected);
  c.className = "conn " + (st.connected ? (st.demo ? "demo" : "on") : "off");
  $("#connText").textContent = st.message === "Không nối được về máy tính cắm board" ? "Máy tính cắm board offline" : st.connected ? (st.demo ? "Mô phỏng (bệnh nhân ảo)" : `Board ${st.port} · HX711 ${st.hx ?? "?"}/6`) : "Chưa kết nối board";
  c.title = st.message || "";
  const ss = $("#setStatus"); if (ss) ss.textContent = st.message || "";
}

let liveQueued = false;
function scheduleLive() { if (!liveQueued) { liveQueued = true; requestAnimationFrame(() => { liveQueued = false; renderLive(); if (RUN && RUN.draw) RUN.draw(); }); } }

function buildLive() {
  $("#liveForces").innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<div class="lf ${i === 5 ? "grip" : ""}" id="lf${i}"><div class="col"><div></div></div><div class="val">0</div><div>${i === 5 ? "② Bóp tay" : `① P${i + 1} · ${fingerNames()[i].replace("Ngón ", "")}`}</div></div>`).join("");
  $("#liveGame").innerHTML = [0, 1, 2, 3].map((k) => `<div class="led" style="color:${LED_COLORS[k]}" id="lg${k}"></div>`).join("");
}
function renderLive() {
  const f = S.frame; if (!f) return;
  const tf = S.settings?.target_finger_counts || 8000, tg = S.settings?.target_grip_counts || 60000;
  for (let i = 0; i < 6; i++) {
    const el = $(`#lf${i}`); if (!el) continue;
    const v = shown(forceOf(f, i)), full = i === 5 ? tg : tf;
    el.querySelector(".col div").style.height = `${clamp((v / full) * 100, 0, 100)}%`;
    el.querySelector(".val").textContent = f.f[i] == null ? "—" : fmtForce(v, i);
    el.classList.toggle("bad", f.f[i] == null);
  }
  $("#liveEnc").textContent = f.enc;
  $("#liveSw").textContent = `nút núm: ${f.sw ? "NHẤN" : "thả"}`;
  const pct = Math.round((f.pot / 4095) * 100);
  $("#livePot").textContent = `${pct}%`;
  $("#livePotBar").style.width = `${pct}%`;
  f.g.forEach((v, k) => { const l = $(`#lg${k}`); if (l) { l.classList.toggle("on", !!v); l.style.background = v ? LED_COLORS[k] : ""; } });
  $("#liveB9").textContent = `③ 9 lỗ: ${f.b9 ? "CHẠM" : "thả"}`;
  if (S.view === "settings") renderCalLive();
}

// ------------------------------------------------------------------ điều hướng
function show(view) {
  S.view = view;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$("nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "progress") renderProgress();
  if (view === "settings") loadSettings();
  if (view === "ai") renderAI();
  if (view === "patients") renderPatients();
  if (view === "train") renderExGrid();
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-view]"); if (a) { show(a.dataset.view); return; }
  const g = e.target.closest("[data-goto]"); if (g) { show(g.dataset.goto); return; }
  const c = e.target.closest("[data-cmd]"); if (c) cmd(c.dataset.cmd);
});

// ------------------------------------------------------------------ người tập
async function loadPatients() {
  S.patients = await api("/api/patients");
  const saved = Number(localStorage.getItem("rb_pid") || 0);
  if (!S.patients.find((p) => p.id === S.pid)) S.pid = S.patients.find((p) => p.id === saved)?.id ?? S.patients[0]?.id ?? null;
  $("#patientSel").innerHTML = S.patients.length ? S.patients.map((p) => `<option value="${p.id}" ${p.id === S.pid ? "selected" : ""}>${esc(p.name)}</option>`).join("") : `<option value="">— Chưa có người tập —</option>`;
}
$("#patientSel").addEventListener("change", async (e) => { S.pid = Number(e.target.value) || null; localStorage.setItem("rb_pid", S.pid || ""); await refreshPatientData(); });

async function refreshPatientData() {
  buildLive();
  if (!S.pid) { S.sessions = []; S.ai = []; renderOverview(); return; }
  [S.sessions, S.ai] = await Promise.all([api(`/api/patients/${S.pid}/sessions`), api(`/api/patients/${S.pid}/ai`)]);
  renderOverview();
  if (S.view === "progress") renderProgress();
  if (S.view === "ai") renderAI();
  if (S.view === "train") renderExGrid();
}

function renderPatients() {
  $("#patientList").innerHTML = S.patients.length ? `<div class="plist">${S.patients.map((p) => `
    <div class="pitem ${p.id === S.pid ? "sel" : ""}">
      <div><b>${esc(p.name)}</b><span class="muted small">${[p.birth_year && `sinh ${p.birth_year}`, p.gender, p.hand === "trai" ? "tay trái" : "tay phải", `${p.n_sessions} buổi tập`].filter(Boolean).join(" · ")}${p.diagnosis ? `<br>${esc(p.diagnosis)}` : ""}</span></div>
      <div class="acts"><button class="btn ghost" data-sel="${p.id}">Chọn</button><button class="btn ghost" data-edit="${p.id}">Sửa</button><button class="btn danger" data-del="${p.id}">Xoá</button></div>
    </div>`).join("")}</div>` : `<p class="muted">Chưa có người tập. Thêm ở khung bên phải.</p>`;
}
$("#patientList").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.sel) { S.pid = Number(b.dataset.sel); localStorage.setItem("rb_pid", S.pid); await loadPatients(); await refreshPatientData(); renderPatients(); toast("Đã chọn người tập"); }
  if (b.dataset.edit) {
    const p = S.patients.find((x) => x.id === Number(b.dataset.edit)), f = $("#patientForm");
    for (const k of ["id", "name", "birth_year", "gender", "hand", "diagnosis", "notes"]) f.elements[k].value = p[k] ?? "";
    $("#pfTitle").textContent = "Sửa thông tin người tập";
  }
  if (b.dataset.del) {
    const p = S.patients.find((x) => x.id === Number(b.dataset.del));
    if (!confirm(`Xoá "${p.name}" và toàn bộ buổi tập, phân tích AI của người này?`)) return;
    await api(`/api/patients/${p.id}`, { method: "DELETE" });
    await loadPatients(); await refreshPatientData(); renderPatients();
  }
});
$("#pfReset").addEventListener("click", () => { $("#patientForm").reset(); $("#patientForm").elements.id.value = ""; $("#pfTitle").textContent = "Thêm người tập"; });
$("#patientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, body = Object.fromEntries(new FormData(f).entries());
  try {
    if (body.id) await api(`/api/patients/${body.id}`, { method: "PUT", body });
    else { const r = await api("/api/patients", { body }); S.pid = r.id; localStorage.setItem("rb_pid", S.pid); }
    f.reset(); f.elements.id.value = ""; $("#pfTitle").textContent = "Thêm người tập";
    await loadPatients(); await refreshPatientData(); renderPatients(); toast("Đã lưu người tập");
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------------ điểm & tổng quan
function latestByEx(sessions) {
  const m = {};
  for (const s of sessions) if (s.score != null && (!m[s.exercise] || s.started > m[s.exercise].started)) m[s.exercise] = s;
  return m;
}
function dailyScores(sessions) {
  const days = [...new Set(sessions.map((s) => dayKey(s.started)))].sort();
  const out = [];
  for (const d of days) {
    const upto = sessions.filter((s) => dayKey(s.started) <= d);
    const lat = latestByEx(upto), vals = Object.values(lat).map((s) => s.score);
    const ts = Math.max(...sessions.filter((s) => dayKey(s.started) === d).map((s) => s.started));
    if (vals.length) out.push({ x: ts, y: Math.round(avg(vals)), day: d });
  }
  return out;
}
const scoreColor = (v) => (v == null ? "#c7d3df" : v >= 70 ? "#2fae4a" : v >= 50 ? "#f2b01e" : "#e5533d");

function drawHand(scores) {
  const left = S.patients.find((p) => p.id === S.pid)?.hand === "trai";
  // tay phải nhìn từ mu bàn tay: ngón cái bên trái
  const F = [
    { x: 50, y: 124, w: 30, h: 84, r: -42 },  // cái: gốc nằm trong mép trái lòng bàn tay
    { x: 64, y: 34, w: 28, h: 96, r: -5 },    // trỏ
    { x: 96, y: 18, w: 29, h: 112, r: 0 },    // giữa
    { x: 129, y: 28, w: 28, h: 102, r: 5 },   // áp út
    { x: 161, y: 56, w: 25, h: 80, r: 11 },   // út
  ];
  let g = `<g ${left ? 'transform="translate(220,0) scale(-1,1)"' : ""}>`;
  g += `<rect x="58" y="112" width="132" height="112" rx="34" fill="#f6d9c4" stroke="#d9a98a" stroke-width="2"/>`;
  F.forEach((f, i) => {
    const v = scores ? scores[i] : null, cx = f.x + f.w / 2, cy = f.y + f.h;
    g += `<g transform="rotate(${f.r} ${cx} ${cy})"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${f.w / 2}" fill="${scoreColor(v)}" stroke="#fff" stroke-width="2.5" opacity=".92"/>`;
    g += `<text x="${cx}" y="${f.y + 22}" font-size="12" font-weight="800" fill="#fff" text-anchor="middle" ${left ? `transform="translate(${2 * cx},0) scale(-1,1)"` : ""}>${v ?? ""}</text></g>`;
  });
  g += "</g>";
  $("#handSvg").innerHTML = g;
}

function renderWelcome() {
  const noPatient = !S.patients.length, noSession = !S.sessions.length;
  $("#welcome").classList.toggle("hidden", !(noPatient || noSession));
  $("#stBoard").classList.toggle("done", !!S.status.connected);
  $("#stPatient").classList.toggle("done", !noPatient);
  const b = $("#welcomeBtn");
  if (noPatient) { b.textContent = "+ Thêm người tập"; b.dataset.goto = "patients"; }
  else { b.textContent = "▶ Bắt đầu bài tập đầu tiên"; b.dataset.goto = "train"; }
}

function renderOverview() {
  renderWelcome();
  const ss = S.sessions, names = fingerNames();
  const lastFinger = [...ss].reverse().find((s) => s.exercise === "finger");
  const fs = lastFinger?.metrics?.fingers;
  const scores = fs ? fs.map((x) => x.score) : null;
  drawHand(scores);
  $("#fingerBars").innerHTML = names.map((n, i) => {
    const v = scores ? scores[i] : null;
    return `<div class="fb"><span>${n}</span><div class="bar"><div style="width:${v ?? 0}%;background:${scoreColor(v)}"></div></div><b>${v ?? "–"}</b></div>`;
  }).join("");
  $("#handDate").textContent = lastFinger ? fmtDate(lastFinger.started) : "";
  const flagged = fs ? fs.filter((x) => x.flag).map((x) => x.name) : [];
  $("#handNote").innerHTML = !fs ? "Làm bài “Nhấn từng ngón” để có hồ sơ bàn tay." :
    flagged.length ? `<span class="flag">⚠ ${esc(flagged.join(", "))}: gần như không có tín hiệu — kiểm tra cảm biến/phím.</span>` : "Điểm 0–100 theo lực đỉnh, độ ổn định và khả năng tách ngón.";

  const daily = dailyScores(ss);
  const cur = daily.at(-1)?.y, prev = daily.at(-2)?.y;
  $("#scoreBig").textContent = cur ?? "--";
  const dEl = $("#scoreDelta");
  if (cur != null && prev != null) { const d = cur - prev; dEl.textContent = `${d >= 0 ? "▲ +" : "▼ "}${d} điểm`; dEl.className = "score-delta" + (d < 0 ? " neg" : ""); } else { dEl.textContent = ""; }
  lineChart($("#scoreTrend"), [{ name: "Điểm", color: "#1e6fd9", points: daily.slice(-14) }], { ymin: 0, ymax: 100, w: 320, h: 150, area: true, empty: "Tập ít nhất 1 bài để có điểm." });

  const today = dayKey(Date.now() / 1000);
  const doneToday = new Set(ss.filter((s) => dayKey(s.started) === today).map((s) => s.exercise));
  const n = ACTIVE_EX.filter((k) => doneToday.has(k)).length;
  $("#todayCount").textContent = `${n}/${ACTIVE_EX.length} hoàn thành`;
  $("#todayBar").style.width = `${(n / ACTIVE_EX.length) * 100}%`;
  $("#todayList").innerHTML = ACTIVE_EX.map((k) => `<li><span class="${doneToday.has(k) ? "ok" : "no"}">${doneToday.has(k) ? "✔" : "○"}</span>${EX[k].ico} ${EX[k].title}</li>`).join("");

  const lastAI = S.ai.find((r) => r.kind === "phan_tich");
  $("#aiLast").innerHTML = lastAI ? `<div class="muted small">${fmtDate(lastAI.created)} · ${esc(lastAI.model)}</div>${md(lastAI.text)}` : `Chưa có phân tích. Vào <a data-goto="ai">Trợ lý AI</a> để phân tích.`;
}

// ------------------------------------------------------------------ bài tập
function renderExGrid() {
  const lat = latestByEx(S.sessions);
  $("#exGrid").innerHTML = Object.values(EX).map((e) => `
    <div class="card ex ${e.disabled ? "disabled" : ""}" style="--c:${e.c}" data-ex="${e.key}">
      <div class="ex-num">${e.n}</div><div class="ex-ico">${e.ico}</div>
      <h4>${e.title}</h4><p>${e.desc}</p>
      ${e.disabled ? `<span class="badge">Chưa có cảm biến</span>` :
      `<div class="ex-last">${lat[e.key] ? `Lần gần nhất: <b>${Math.round(lat[e.key].score)}</b> điểm · ${fmtDate(lat[e.key].started)}` : "Chưa tập"}</div>`}
    </div>`).join("");
}
$("#exGrid").addEventListener("click", (e) => {
  const c = e.target.closest("[data-ex]"); if (!c) return;
  const ex = EX[c.dataset.ex]; if (ex.disabled) return;
  openRunner(ex);
});

let RUN = null;
const demo = () => !!S.status.demo;

function openRunner(ex) {
  if (RUN && !RUN.done) return toast("Đang có bài tập chạy");
  const r = $("#runner");
  r.style.setProperty("--c", ex.c);
  r.classList.remove("hidden");
  $("#rTag").textContent = `MÔ-ĐUN ${ex.n}`;
  $("#rTitle").textContent = `${ex.ico} ${ex.title}`;
  $("#rDesc").textContent = RUNNERS[ex.key].howto();
  $("#rResult").classList.add("hidden");
  $("#rPhase").textContent = "Sẵn sàng";
  $("#rCount").textContent = "";
  $("#rProg").style.width = "0";
  $("#rStart").disabled = false; $("#rStop").disabled = true;
  RUN = { ex, abort: false, done: true, draw: null };
  RUNNERS[ex.key].stage();
  RUN.draw = RUNNERS[ex.key].draw || null;
  r.scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#rClose").addEventListener("click", () => { if (RUN) RUN.abort = true; $("#runner").classList.add("hidden"); });
$("#rStop").addEventListener("click", () => { if (RUN) RUN.abort = true; });
$("#rStart").addEventListener("click", async () => {
  if (!S.status.connected) return toast("Chưa kết nối board (hoặc bật chế độ mô phỏng trong Cài đặt)");
  if (!S.pid) { toast("Hãy thêm/chọn người tập trước"); return show("patients"); }
  const ex = RUN.ex, def = RUNNERS[ex.key];
  RUN = { ex, abort: false, done: false, draw: def.draw || null, t0: Date.now() / 1000 };
  $("#rStart").disabled = true; $("#rStop").disabled = false; $("#rResult").classList.add("hidden");
  def.stage();
  try {
    const res = await def.run();
    RUN.done = true;
    await finish(ex, res);
  } catch (err) {
    RUN.done = true;
    if (err.message !== "abort") toast(err.message);
    $("#rPhase").textContent = "Đã dừng"; $("#rCount").textContent = "";
  } finally {
    if (def.cleanup) def.cleanup();
    $("#rStart").disabled = false; $("#rStop").disabled = true;
  }
});

function setPhase(t) { $("#rPhase").textContent = t; }
function setProg(f) { $("#rProg").style.width = `${clamp(f, 0, 1) * 100}%`; }

/** chạy 1 pha trong `secs` giây; tick(el) trả true để kết thúc sớm */
function phase(label, secs, tick) {
  return new Promise((res, rej) => {
    const t0 = performance.now();
    setPhase(label);
    const iv = setInterval(() => {
      if (RUN.abort) { clearInterval(iv); rej(new Error("abort")); return; }
      const el = (performance.now() - t0) / 1000;
      $("#rCount").textContent = Math.max(0, Math.ceil(secs - el));
      const stop = tick ? tick(el) : false;
      if (stop || el >= secs) { clearInterval(iv); res(el); }
    }, 50);
  });
}
function waitEvent(pred, ms) {
  return new Promise((res) => {
    const f = (ev) => { if (pred(ev)) { S.evListeners.delete(f); clearTimeout(t); res(ev); } };
    const t = setTimeout(() => { S.evListeners.delete(f); res(null); }, ms);
    S.evListeners.add(f);
  });
}

/** đặt 0 load cell trước bài đo lực (lực trôi theo thời gian / nhiệt độ) */
async function autoTare() {
  setPhase("Đặt 0 — KHÔNG chạm vào phím");
  $("#rCount").textContent = "";
  const done = waitEvent((e) => e.ev === "tare" && e.state === "done", 7000);
  await cmd("TARE");
  const ok = await done;
  if (RUN.abort) throw new Error("abort");
  if (!ok) toast("Board không báo đặt 0 xong — vẫn tiếp tục");
}

async function finish(ex, res) {
  setPhase("Hoàn thành 🎉"); $("#rCount").textContent = ""; setProg(1);
  cmd("BEEP 120");
  const box = $("#rResult");
  box.classList.remove("hidden");
  box.innerHTML = `<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><div class="rs-score">${res.score} điểm</div><div class="muted">${esc(res.summary)}</div></div>${res.table}`;
  try {
    await api("/api/sessions", { body: { patient_id: S.pid, exercise: ex.key, started: RUN.t0, ended: Date.now() / 1000, score: res.score, metrics: res.metrics } });
    box.insertAdjacentHTML("beforeend", `<p class="muted small">✔ Đã lưu vào hồ sơ${demo() ? " (dữ liệu mô phỏng)" : ""}. <a data-goto="ai">Nhờ AI phân tích →</a></p>`);
    await refreshPatientData();
  } catch (err) { box.insertAdjacentHTML("beforeend", `<p class="flag">Không lưu được: ${esc(err.message)}</p>`); }
}

const RUNNERS = {
  // ---------------- 1. nhấn từng ngón
  finger: {
    reps: 2,
    howto() { return "Đặt bàn tay lên 5 phím. Khi ngón được tô màu, nhấn ngón đó MẠNH NHẤT có thể và giữ 3 giây, các ngón khác thả lỏng. Mỗi ngón 2 lần."; },
    stage() {
      const names = fingerNames();
      $("#rStage").innerHTML = `<div class="st-fingers">${[0, 1, 2, 3, 4].map((i) => `<div class="st-f" id="sf${i}"><div class="col"><div></div><span class="tline"></span></div><span>${names[i].replace("Ngón ", "")}</span><span class="muted small" id="sfv${i}">0</span></div>`).join("")}<div class="st-f"><div class="col"><div style="background:#cfe7d2"></div></div><span>Bóp tay</span><span class="muted small">—</span></div></div><div class="st-big" id="sfMsg"></div>`;
      RUN.target = -1;
    },
    draw() {
      const f = S.frame; if (!f || !$("#sf0")) return;
      const tf = S.settings?.target_finger_counts || 8000;
      for (let i = 0; i < 5; i++) {
        const v = shown(forceOf(f, i));
        $(`#sf${i} .col div`).style.height = `${clamp((v / (tf * 1.3)) * 100, 0, 100)}%`;
        $(`#sf${i} .tline`).style.bottom = `${(1 / 1.3) * 100}%`;
        $(`#sfv${i}`).textContent = fmtForce(v, i);
        $(`#sf${i}`).classList.toggle("target", RUN.target === i);
      }
    },
    async run() {
      const names = fingerNames(), reps = this.reps, rec = [[], [], [], [], []];
      const total = 5 * reps; let n = 0;
      await autoTare();
      for (let i = 0; i < 5; i++) {
        for (let r = 0; r < reps; r++) {
          RUN.target = i;
          $("#sfMsg").textContent = `${names[i]} — lần ${r + 1}/${reps}`;
          await phase(`Chuẩn bị: ${names[i]}`, 2);
          if (demo()) cmd(`SIM PRESS ${i} 3000`);
          cmd("BEEP 60");
          const samples = [];
          await phase(`NHẤN & GIỮ`, 3, (el) => { if (S.frame) samples.push({ el, v: [0, 1, 2, 3, 4].map((k) => forceOf(S.frame, k)) }); });
          rec[i].push(samples);
          RUN.target = -1;
          setProg(++n / total);
          await phase("Thả tay, nghỉ", 1.5);
        }
      }
      const target = S.settings?.target_finger_counts || 8000;
      const fingers = rec.map((reps, i) => {
        const all = reps.flat();
        const peak = Math.max(0, ...all.map((s) => s.v[i]));
        const hold = all.filter((s) => s.el >= 1);
        const mine = hold.map((s) => s.v[i]);
        const others = hold.map((s) => s.v.reduce((a, b, k) => a + (k === i ? 0 : b), 0));
        const mean = avg(mine);
        const stability = mean > 0 ? clamp(1 - sd(mine) / mean, 0, 1) : 0;
        const selectivity = mean > 0 ? clamp(mean / (mean + avg(others)), 0, 1) : 0;
        const flag = peak < 300;
        const score = Math.round(60 * Math.min(1, peak / target) + 25 * selectivity + 15 * stability);
        return { phim: i + 1, name: names[i], peak: Math.round(peak), mean: Math.round(mean), peak_unit: +toUnit(peak, i).toFixed(2), stability: +stability.toFixed(2), selectivity: +selectivity.toFixed(2), score, flag: flag ? "gần như không có tín hiệu (kiểm tra cảm biến/phím)" : null };
      });
      const score = Math.round(avg(fingers.map((f) => f.score)));
      const weak = [...fingers].sort((a, b) => a.score - b.score)[0];
      return {
        score,
        summary: `Ngón cần tập thêm: ${weak.name} (${weak.score} điểm)`,
        metrics: { unit: unitLabel(), target_counts: target, reps, fingers },
        table: `<table><tr><th>Ngón</th><th>Lực đỉnh</th><th>Ổn định</th><th>Tách ngón</th><th>Điểm</th></tr>${fingers.map((f) => `<tr><td>${f.name}${f.flag ? ` <span class="flag">⚠ ${f.flag}</span>` : ""}</td><td>${fmtForce(f.peak, f.phim - 1)}</td><td>${Math.round(f.stability * 100)}%</td><td>${Math.round(f.selectivity * 100)}%</td><td><b>${f.score}</b></td></tr>`).join("")}</table>`,
      };
    },
  },

  // ---------------- 2. bóp tay
  grip: {
    howto() { return "Nắm tay cầm bóp. Khi có hiệu lệnh, bóp MẠNH NHẤT có thể và giữ 4 giây, rồi thả nghỉ. Làm 3 lần."; },
    stage() {
      $("#rStage").innerHTML = `<div style="display:flex;gap:30px;align-items:end;justify-content:center;height:270px"><div class="st-f target" style="width:120px"><div class="col" style="max-width:120px"><div id="gBar"></div><span class="tline" id="gLine"></span></div><span>Bóp tay</span></div><div><div class="st-big" id="gVal">0</div><div class="muted small" style="text-align:center">lực hiện tại</div><div class="st-big" id="gPeak" style="font-size:20px">Đỉnh: –</div></div></div>`;
      RUN.peakNow = 0;
    },
    draw() {
      const f = S.frame; if (!f || !$("#gBar")) return;
      const tg = S.settings?.target_grip_counts || 60000, v = shown(forceOf(f, 5));
      $("#gBar").style.height = `${clamp((v / (tg * 1.3)) * 100, 0, 100)}%`;
      $("#gBar").style.background = "linear-gradient(0deg,#2e9e46,#9ae07a)";
      $("#gLine").style.bottom = `${(1 / 1.3) * 100}%`;
      $("#gVal").textContent = fmtForce(v, 5);
    },
    async run() {
      const reps = 3, out = [];
      await autoTare();
      for (let r = 0; r < reps; r++) {
        await phase(`Chuẩn bị — lần ${r + 1}/${reps}`, 2);
        if (demo()) cmd("SIM PRESS 5 4000");
        cmd("BEEP 60");
        const s = [];
        await phase("BÓP MẠNH & GIỮ", 4, (el) => { if (S.frame) s.push({ el, v: forceOf(S.frame, 5) }); });
        const peak = Math.max(0, ...s.map((x) => x.v));
        // giữ lực = lực trung bình giây cuối / lực đỉnh (giây đầu còn đang tăng lực nên không dùng làm mốc)
        const last = avg(s.filter((x) => x.el >= 3).map((x) => x.v));
        out.push({ peak, endurance: peak > 0 ? clamp(last / peak, 0, 1) : 0 });
        $("#gPeak").textContent = `Đỉnh: ${fmtForce(Math.max(...out.map((o) => o.peak)), 5)}`;
        setProg((r + 1) / reps);
        if (r < reps - 1) await phase("Thả tay, nghỉ", 4);
      }
      const tg = S.settings?.target_grip_counts || 60000;
      const peaks = out.map((o) => o.peak), peak = Math.max(...peaks);
      const endurance = avg(out.map((o) => o.endurance)), consistency = peak > 0 ? Math.min(...peaks) / peak : 0;
      const score = Math.round(70 * Math.min(1, peak / tg) + 15 * endurance + 15 * consistency);
      return {
        score, summary: `Lực đỉnh ${fmtForce(peak, 5)} · giữ lực ${Math.round(endurance * 100)}%`,
        metrics: { unit: unitLabel(), target_counts: tg, peaks: peaks.map(Math.round), peak: Math.round(peak), peak_unit: +toUnit(peak, 5).toFixed(2), endurance: +endurance.toFixed(2), consistency: +consistency.toFixed(2) },
        table: `<table><tr><th>Lần</th><th>Lực đỉnh</th><th>Giữ lực (giây cuối / đỉnh)</th></tr>${out.map((o, k) => `<tr><td>${k + 1}</td><td>${fmtForce(o.peak, 5)}</td><td>${Math.round(o.endurance * 100)}%</td></tr>`).join("")}<tr><th>Đều tay</th><td colspan="2">${Math.round(consistency * 100)}% (lần yếu nhất / lần mạnh nhất)</td></tr></table>`,
      };
    },
  },

  // ---------------- 3. 9 lỗ (Nine-Hole Peg Test, bản chạm)
  // 9 công tắc đáy lỗ nối song song vào GPIO10 -> mỗi lần cắm/chạm là 1 nhịp nhấn-nhả ({"ev":"b9"} có mốc thời gian board).
  holes: {
    rounds: 2, limit: 60,
    howto() { return "Khi nghe bíp, cắm chốt (hoặc chạm ngón) lần lượt vào đủ 9 lỗ, NHANH và CHÍNH XÁC nhất có thể — mỗi lỗ chạm rồi nhấc ra. Làm 2 vòng, mỗi vòng tối đa 60 giây."; },
    stage() {
      $("#rStage").innerHTML = `<div class="holes-wrap"><div class="holes" id="hGrid">${Array.from({ length: 9 }, (_, k) => `<div class="hole" id="h${k}">${k + 1}</div>`).join("")}</div><div class="holes-side"><div class="st-big" id="hTime" style="margin-top:0">0.0 s</div><div class="muted" style="text-align:center">thời gian vòng này</div><div class="st-big" id="hCount" style="font-size:22px">0/9 lỗ</div><div class="muted small" style="text-align:center" id="hBest"></div></div></div>`;
      RUN.hTaps = 0; RUN.hT0 = null;
    },
    draw() {
      if (!$("#hTime")) return;
      if (RUN.hT0 != null && RUN.hRunning) $("#hTime").textContent = `${((performance.now() - RUN.hT0) / 1000).toFixed(1)} s`;
    },
    fill(n) { for (let k = 0; k < 9; k++) $(`#h${k}`)?.classList.toggle("on", k < n); $("#hCount").textContent = `${n}/9 lỗ`; },
    async run() {
      const out = [];
      for (let r = 0; r < this.rounds; r++) {
        this.fill(0); RUN.hRunning = false; $("#hTime").textContent = "0.0 s";
        await phase(`Vòng ${r + 1}/${this.rounds} — chuẩn bị, tay đặt cạnh bảng`, 3);
        const taps = [], holds = [];
        let pressT = null;
        const tGo = S.frame?.t ?? null;            // mốc thời gian board lúc ra hiệu lệnh
        const onEv = (e) => {
          if (e.ev !== "b9" || RUN.abort) return;
          if (e.v === 1) { pressT = e.t; taps.push(e.t); this.fill(Math.min(9, taps.length)); }
          else if (pressT != null) { holds.push(e.t - pressT); pressT = null; }
        };
        S.evListeners.add(onEv);
        cmd("BEEP 120");
        RUN.hT0 = performance.now(); RUN.hRunning = true;
        try {
          await phase("CẮM / CHẠM ĐỦ 9 LỖ!", this.limit, () => taps.length >= 9);
        } finally {
          S.evListeners.delete(onEv);
          RUN.hRunning = false;
        }
        const n = Math.min(9, taps.length);
        const t9 = n >= 9 ? taps[8] : null;
        const timeS = t9 != null && tGo != null ? (t9 - tGo) / 1000 : (performance.now() - RUN.hT0) / 1000;
        const gaps = taps.slice(0, 9).map((t, k, a) => (k ? t - a[k - 1] : null)).filter((x) => x != null);
        const rhythm = gaps.length >= 3 ? clamp(1 - sd(gaps) / avg(gaps), 0, 1) : 0;
        out.push({ taps: n, time_s: +timeS.toFixed(2), complete: n >= 9, avg_gap_ms: Math.round(avg(gaps)) || null, rhythm: +rhythm.toFixed(2), avg_hold_ms: Math.round(avg(holds)) || null });
        $("#hTime").textContent = `${timeS.toFixed(1)} s`;
        const best = out.filter((o) => o.complete).map((o) => o.time_s);
        $("#hBest").textContent = best.length ? `Tốt nhất: ${Math.min(...best).toFixed(1)} s` : "";
        cmd(n >= 9 ? "BEEP 60" : "BEEP 400");
        setProg((r + 1) / this.rounds);
        if (r < this.rounds - 1) await phase("Nghỉ, rút chốt ra", 6);
      }
      const done = out.filter((o) => o.complete);
      const best = done.length ? Math.min(...done.map((o) => o.time_s)) : null;
      // 9 lần cắm/chạm: <= 10 s đạt tối đa, >= 40 s = 0 (có thể chỉnh khi có số liệu chuẩn của nhóm)
      const timeScore = best != null ? clamp((40 - best) / 30, 0, 1) * 100 : 0;
      const completion = Math.max(...out.map((o) => o.taps)) / 9;
      const rhythm = avg(out.map((o) => o.rhythm));
      const score = Math.round(best != null ? 0.8 * timeScore + 0.2 * rhythm * 100 : 0.5 * completion * 100 * 0.5);
      return {
        score,
        summary: best != null ? `Tốt nhất ${best.toFixed(1)} s cho 9 lỗ · nhịp đều ${Math.round(rhythm * 100)}%` : `Chưa xong 9 lỗ (được ${Math.max(...out.map((o) => o.taps))}/9)`,
        metrics: { rounds: out, best_time_s: best, rhythm: +rhythm.toFixed(2), note: "9 công tắc đáy lỗ nối song song: đếm số lần cắm/chạm, không biết lỗ nào; thời gian theo đồng hồ board" },
        table: `<table><tr><th>Vòng</th><th>Số lỗ</th><th>Thời gian</th><th>Khoảng cách TB giữa 2 lỗ</th><th>Nhịp đều</th><th>Giữ mỗi lần chạm</th></tr>${out.map((o, k) => `<tr><td>${k + 1}</td><td>${o.taps}/9${o.complete ? "" : ' <span class="flag">chưa đủ</span>'}</td><td>${o.time_s} s</td><td>${o.avg_gap_ms ?? "–"} ms</td><td>${Math.round(o.rhythm * 100)}%</td><td>${o.avg_hold_ms ?? "–"} ms</td></tr>`).join("")}</table>`,
      };
    },
  },

  // ---------------- 4. xoay núm
  rotate: {
    targets: [6, -6, 12, -12, 0, 18, -18],
    howto() { return "Xoay núm để kim tới vạch đỏ và giữ ở đó một chút. Có 7 mục tiêu, mỗi mục tiêu tối đa 8 giây. Xoay cả hai chiều để tập cổ tay."; },
    stage() {
      $("#rStage").innerHTML = `<svg class="dial" viewBox="-120 -120 240 240"><circle r="100" fill="#fff" stroke="#c9d8e8" stroke-width="10"/>${Array.from({ length: 20 }, (_, k) => `<line x1="0" y1="-86" x2="0" y2="-78" stroke="#9fb4c9" stroke-width="3" transform="rotate(${k * 18})"/>`).join("")}<line id="rTgt" x1="0" y1="0" x2="0" y2="-100" stroke="#e54848" stroke-width="8" stroke-linecap="round" opacity=".6"/><line id="rNeedle" x1="0" y1="0" x2="0" y2="-80" stroke="var(--ex4)" stroke-width="10" stroke-linecap="round"/><circle r="16" fill="var(--ex4)"/></svg><div class="st-big" id="rMsg" style="margin-top:0"></div>`;
      RUN.tgt = 0;
    },
    draw() {
      const f = S.frame; if (!f || !$("#rNeedle")) return;
      $("#rNeedle").setAttribute("transform", `rotate(${f.enc * 18})`);
      $("#rTgt").setAttribute("transform", `rotate(${RUN.tgt * 18})`);
      $("#rMsg").textContent = `Vị trí ${f.enc} → mục tiêu ${RUN.tgt > 0 ? "+" : ""}${RUN.tgt}`;
    },
    async run() {
      cmd("ENC0");
      await phase("Chuẩn bị", 2);
      const res = []; let mn = 0, mx = 0;
      for (let k = 0; k < this.targets.length; k++) {
        const t = this.targets[k]; RUN.tgt = t;
        if (demo()) cmd(`SIM ROT ${t}`);
        cmd("BEEP 40");
        let holdStart = null, reached = false;
        const el = await phase(`Xoay tới ${t > 0 ? "+" : ""}${t}`, 8, (e) => {
          const p = S.frame?.enc ?? 0; mn = Math.min(mn, p); mx = Math.max(mx, p);
          if (Math.abs(p - t) <= 1) { holdStart ??= e; if (e - holdStart >= 0.4) { reached = true; return true; } } else holdStart = null;
          return false;
        });
        res.push({ target: t, reached, time: +el.toFixed(2) });
        setProg((k + 1) / this.targets.length);
      }
      const ok = res.filter((r) => r.reached);
      const score = Math.round(avg(res.map((r) => (r.reached ? 100 * clamp((8 - r.time) / 7, 0.35, 1) : 0))));
      return {
        score, summary: `Đạt ${ok.length}/${res.length} mục tiêu · TB ${avg(ok.map((r) => r.time)).toFixed(1)} s · biên độ ${mx - mn} nấc`,
        metrics: { targets: res, success: ok.length, total: res.length, avg_time_s: +avg(ok.map((r) => r.time)).toFixed(2), range_steps: mx - mn },
        table: `<table><tr><th>Mục tiêu</th><th>Kết quả</th><th>Thời gian</th></tr>${res.map((r) => `<tr><td>${r.target > 0 ? "+" : ""}${r.target}</td><td>${r.reached ? "✔ đạt" : '<span class="flag">✘ chưa đạt</span>'}</td><td>${r.time} s</td></tr>`).join("")}</table>`,
      };
    },
  },

  // ---------------- 5. thanh trượt
  slider: {
    dur: 30,
    howto() { return "Kéo thanh trượt để khối màu luôn nằm trong vạch đỏ. Vạch đỏ di chuyển chậm qua lại trong 30 giây."; },
    stage() { $("#rStage").innerHTML = `<div class="track"><div class="tgt" id="sTgt"></div><div class="you" id="sYou"></div></div><div class="st-big" id="sMsg">Giữ khối màu trong vạch đỏ</div>`; RUN.tp = 10; },
    draw() {
      const f = S.frame; if (!f || !$("#sYou")) return;
      $("#sYou").style.left = `${(f.pot / 4095) * 100}%`;
      $("#sTgt").style.left = `${RUN.tp}%`;
    },
    async run() {
      const tgt = (el) => 50 + 40 * Math.sin((2 * Math.PI * el) / 10 - Math.PI / 2);
      RUN.tp = tgt(0);
      if (demo()) cmd(`SIM POT ${Math.round(RUN.tp)}`);
      await phase("Chuẩn bị: kéo tới vạch đỏ", 3);
      const s = []; let lastSim = 0;
      await phase("BÁM THEO VẠCH ĐỎ", this.dur, (el) => {
        RUN.tp = tgt(el);
        if (demo() && el - lastSim > 0.2) { lastSim = el; cmd(`SIM POT ${Math.round(RUN.tp)}`); }
        if (S.frame) s.push({ t: RUN.tp, y: (S.frame.pot / 4095) * 100 });
        setProg(el / this.dur);
        const e = s.length ? Math.abs(s.at(-1).t - s.at(-1).y) : 0;
        $("#sMsg").textContent = e <= 10 ? "👍 Tốt lắm!" : "Kéo theo vạch đỏ";
      });
      const err = s.map((x) => Math.abs(x.t - x.y));
      const mae = avg(err), within = (err.filter((e) => e <= 10).length / Math.max(1, err.length)) * 100;
      const ys = s.map((x) => x.y), range = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      const score = Math.round(0.6 * within + 0.4 * Math.max(0, 100 - 2 * mae));
      return {
        score, summary: `Sai lệch TB ${mae.toFixed(1)}% · trong vạch ${Math.round(within)}% thời gian`,
        metrics: { duration_s: this.dur, mean_error_pct: +mae.toFixed(1), within10_pct: Math.round(within), range_pct: Math.round(range) },
        table: `<table><tr><th>Sai lệch trung bình</th><td>${mae.toFixed(1)} %</td></tr><tr><th>Thời gian nằm trong vạch (±10%)</th><td>${Math.round(within)} %</td></tr><tr><th>Biên độ kéo được</th><td>${Math.round(range)} % hành trình${range < 60 ? ' <span class="flag">(hẹp — kiểm tra thanh trượt hoặc tập thêm biên độ)</span>' : ""}</td></tr></table>`,
      };
    },
  },

  // ---------------- 6. game phản xạ
  game: {
    trials: 12,
    howto() { return "Khi một đèn sáng (kèm tiếng bíp), nhấn NGAY nút cùng màu trên board. 12 lượt. Đừng nhấn trước khi đèn sáng."; },
    stage() { $("#rStage").innerHTML = `<div class="game-leds">${[0, 1, 2, 3].map((k) => `<div class="game-led" id="gl${k}" style="border-color:${LED_COLORS[k]}">${k + 1}</div>`).join("")}</div><div class="game-msg" id="gMsg">Nhìn đèn trên board hoặc trên màn hình</div>`; },
    light(k, on) { const e = $(`#gl${k}`); if (e) { e.classList.toggle("on", on); e.style.background = on ? LED_COLORS[k] : ""; } },
    cleanup() { cmd("LEDS AUTO"); for (let k = 0; k < 4; k++) RUNNERS.game.light(k, false); },
    async run() {
      for (let k = 1; k <= 4; k++) cmd(`LED ${k} 0`);
      const res = [];
      for (let n = 0; n < this.trials; n++) {
        await phase(`Lượt ${n + 1}/${this.trials} — chờ đèn…`, 1 + Math.random() * 1.2);
        const k = Math.floor(Math.random() * 4);
        // board trả mốc thời gian lúc LED sáng và lúc nhấn nút -> phản xạ thật, không dính trễ USB/trình duyệt
        const ackP = waitEvent((e) => e.ack === "LED" && e.i === k + 1 && e.v === 1, 1500);
        const pressP = waitEvent((e) => e.ev === "game" && e.v === 1, 3500);
        this.light(k, true); cmd(`LED ${k + 1} 1`); cmd("BEEP 50");
        const t0 = performance.now();
        setPhase("NHẤN NGAY!");
        const [ack, ev] = await Promise.all([ackP, pressP]);
        const boardRt = ack && ev && ack.t != null && ev.t != null ? ev.t - ack.t : null;
        const rt = boardRt != null && boardRt >= 0 ? boardRt : Math.round(performance.now() - t0);
        this.light(k, false); cmd(`LED ${k + 1} 0`);
        if (RUN.abort) throw new Error("abort");
        if (!ev) { res.push({ led: k + 1, ok: false, miss: true }); $("#gMsg").textContent = "⏱ Hết giờ"; }
        else if (ev.i === k + 1) { res.push({ led: k + 1, ok: true, rt }); $("#gMsg").textContent = `✔ ${rt} ms`; }
        else { res.push({ led: k + 1, ok: false, pressed: ev.i, rt }); $("#gMsg").textContent = `✘ Nhấn nút ${ev.i}, đèn là ${k + 1}`; }
        setProg((n + 1) / this.trials);
      }
      const ok = res.filter((r) => r.ok), rts = ok.map((r) => r.rt);
      const acc = (ok.length / res.length) * 100, mean = avg(rts);
      const score = Math.round(acc * 0.5 + 50 * clamp((1500 - (mean || 1500)) / 1100, 0, 1));
      const byBtn = [1, 2, 3, 4].map((b) => { const r = ok.filter((x) => x.led === b).map((x) => x.rt); return r.length ? Math.round(avg(r)) : null; });
      return {
        score, summary: `Đúng ${ok.length}/${res.length} · phản xạ TB ${Math.round(mean) || "–"} ms · nhanh nhất ${rts.length ? Math.min(...rts) : "–"} ms`,
        metrics: { trials: res.length, correct: ok.length, accuracy_pct: Math.round(acc), avg_rt_ms: Math.round(mean) || null, best_rt_ms: rts.length ? Math.min(...rts) : null, misses: res.filter((r) => r.miss).length, wrong: res.filter((r) => !r.ok && !r.miss).length, avg_rt_by_button_ms: byBtn, note: "phản xạ đo bằng đồng hồ của board (từ lúc LED sáng tới lúc nút được nhấn)" },
        table: `<table><tr><th>Đúng</th><td>${ok.length}/${res.length} (${Math.round(acc)}%)</td></tr><tr><th>Phản xạ trung bình</th><td>${Math.round(mean) || "–"} ms</td></tr><tr><th>Theo nút (1–4)</th><td>${byBtn.map((v) => v ?? "–").join(" · ")} ms</td></tr><tr><th>Bỏ lỡ / nhấn sai</th><td>${res.filter((r) => r.miss).length} / ${res.filter((r) => !r.ok && !r.miss).length}</td></tr></table>`,
      };
    },
  },
};

// ------------------------------------------------------------------ tiến triển
const EX_COLORS = { finger: "#1e88e5", grip: "#43a047", holes: "#fb8c00", rotate: "#7e57c2", slider: "#1565c0", game: "#ef6c00" };
function renderProgress() {
  const ss = S.sessions;
  lineChart($("#chOverall"), [{ name: "Hand Recovery Score", color: "#1e6fd9", points: dailyScores(ss) }], { ymin: 0, ymax: 100, area: true });
  lineChart($("#chEx"), ACTIVE_EX.map((k) => ({ name: EX[k].title, color: EX_COLORS[k], points: ss.filter((s) => s.exercise === k).map((s) => ({ x: s.started, y: s.score })) })), { ymin: 0, ymax: 100 });
  const fcol = ["#1e88e5", "#43a047", "#fb8c00", "#7e57c2", "#e53935"], names = fingerNames();
  const fss = ss.filter((s) => s.exercise === "finger" && s.metrics?.fingers);
  lineChart($("#chFingers"), names.map((n, i) => ({ name: n, color: fcol[i], points: fss.map((s) => ({ x: s.started, y: toUnit(s.metrics.fingers[i].peak, i) })) })), { fmt: (v) => v.toFixed(allCalibrated() ? 1 : 0) });
  $("#unitNote").textContent = unitLabel();
  const gs = ss.filter((s) => s.exercise === "game" && s.metrics?.avg_rt_ms);
  const grs = ss.filter((s) => s.exercise === "grip");
  const box = $("#chReact");
  box.innerHTML = `<div id="chRT"></div><div id="chGrip"></div>`;
  lineChart($("#chRT"), [{ name: "Phản xạ TB (ms)", color: "#ef6c00", points: gs.map((s) => ({ x: s.started, y: s.metrics.avg_rt_ms })) }], { h: 150, empty: "Chưa chơi game phản xạ." });
  lineChart($("#chGrip"), [{ name: `Bóp tay (${allCalibrated() ? "kg" : "k"})`, color: "#43a047", points: grs.map((s) => ({ x: s.started, y: toUnit(s.metrics.peak || 0, 5) })) }], { h: 150, empty: "Chưa tập bóp tay." });

  $("#sessTable").innerHTML = ss.length ? `<table><tr><th>Thời gian</th><th>Bài tập</th><th>Điểm</th><th>Tóm tắt</th><th></th></tr>${[...ss].reverse().map((s) => `<tr><td>${fmtDate(s.started)}</td><td>${EX[s.exercise]?.ico || ""} ${EX[s.exercise]?.title || s.exercise}${s.demo ? ' <span class="muted small">(mô phỏng)</span>' : ""}</td><td><b>${Math.round(s.score)}</b></td><td class="small">${esc(sessSummary(s))}</td><td><button class="btn ghost" data-dels="${s.id}">Xoá</button></td></tr>`).join("")}</table>` : `<p class="muted">Chưa có buổi tập.</p>`;
}
function sessSummary(s) {
  const m = s.metrics || {};
  switch (s.exercise) {
    case "finger": return (m.fingers || []).map((f) => `${f.name.replace("Ngón ", "")} ${f.score}`).join(" · ");
    case "grip": return `đỉnh ${fmtForce(m.peak || 0, 5)} · giữ ${Math.round((m.endurance || 0) * 100)}%`;
    case "rotate": return `đạt ${m.success}/${m.total} · ${m.avg_time_s}s · biên độ ${m.range_steps}`;
    case "slider": return `sai lệch ${m.mean_error_pct}% · trong vạch ${m.within10_pct}%`;
    case "game": return `đúng ${m.correct}/${m.trials} · ${m.avg_rt_ms ?? "–"} ms`;
    case "holes": return `tốt nhất ${m.best_time_s ?? "–"} s · ${m.rounds?.map((r) => `${r.taps}/9`).join(", ")} · nhịp đều ${Math.round((m.rhythm || 0) * 100)}%`;
    default: return "";
  }
}
$("#sessTable").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-dels]"); if (!b) return;
  if (!confirm("Xoá buổi tập này?")) return;
  await api(`/api/sessions/${b.dataset.dels}`, { method: "DELETE" });
  await refreshPatientData(); renderProgress();
});

// ------------------------------------------------------------------ trợ lý AI
function renderAI() {
  $("#aiModel").textContent = `Model: ${S.status.model || S.settings?.openai_model || "gpt-5.5-mini"} · ${S.status.ai_ready ? "đã có API key" : "CHƯA có API key (vào Cài đặt)"}`;
  const last = S.ai.find((r) => r.kind === "phan_tich");
  if (last && !$("#aiReport").dataset.fresh) $("#aiReport").innerHTML = `<div class="muted small">Phân tích lúc ${fmtDate(last.created)}</div>${md(last.text)}`;
  $("#aiHistory").innerHTML = S.ai.length ? S.ai.map((r) => `<details class="hist-item"><summary>${fmtDate(r.created)} · ${r.kind === "phan_tich" ? "Phân tích" : "Hỏi: " + esc((r.question || "").slice(0, 60))}</summary><div class="md">${md(r.text)}</div></details>`).join("") : `<p class="muted">Chưa có.</p>`;
  renderChat();
}
$("#btnAnalyze").addEventListener("click", async () => {
  if (!S.pid) return toast("Chưa chọn người tập");
  const b = $("#btnAnalyze"); b.disabled = true;
  $("#aiReport").innerHTML = `<span class="spin"></span>ChatGPT đang đọc số liệu và phân tích…`;
  try {
    const r = await api("/api/ai/analyze", { body: { patient_id: S.pid } });
    $("#aiReport").dataset.fresh = "1";
    $("#aiReport").innerHTML = `<div class="muted small">Phân tích lúc ${fmtDate(r.created)} · ${esc(r.model)}</div>${md(r.text)}`;
    S.ai = await api(`/api/patients/${S.pid}/ai`); renderOverview();
    $("#aiHistory").innerHTML = S.ai.map((x) => `<details class="hist-item"><summary>${fmtDate(x.created)} · ${x.kind === "phan_tich" ? "Phân tích" : "Hỏi: " + esc((x.question || "").slice(0, 60))}</summary><div class="md">${md(x.text)}</div></details>`).join("");
  } catch (err) { $("#aiReport").innerHTML = `<p class="flag">${esc(err.message)}</p>`; }
  finally { b.disabled = false; }
});
function renderChat() {
  const log = S.chat[S.pid] || [];
  $("#chatLog").innerHTML = log.length ? log.map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${m.role === "user" ? esc(m.content) : `<div class="md">${md(m.content)}</div>`}</div>`).join("") : `<p class="muted small">Hỏi trợ lý về kết quả tập, ngón yếu, cách tập tại nhà…</p>`;
  $("#chatLog").scrollTop = 1e9;
}
async function sendChat(text) {
  if (!S.pid) return toast("Chưa chọn người tập");
  const log = (S.chat[S.pid] ||= []);
  log.push({ role: "user", content: text });
  renderChat();
  $("#chatLog").insertAdjacentHTML("beforeend", `<div class="msg bot" id="typing"><span class="spin"></span>Đang trả lời…</div>`);
  try {
    const r = await api("/api/ai/chat", { body: { patient_id: S.pid, messages: log } });
    log.push({ role: "assistant", content: r.text });
  } catch (err) { log.push({ role: "assistant", content: `⚠ ${err.message}` }); }
  renderChat();
}
$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#chatInput").value.trim(); if (v) { $("#chatInput").value = ""; sendChat(v); } });
$$(".chip").forEach((c) => c.addEventListener("click", () => sendChat(c.textContent)));

// ------------------------------------------------------------------ cài đặt
async function loadSettings() {
  S.settings = await api("/api/settings");
  const st = S.settings;
  $("#setPort").innerHTML = `<option value="auto">Tự tìm (khuyên dùng)</option>` + st.ports.map((p) => `<option value="${esc(p.device)}">${esc(p.device)} — ${esc(p.desc)}</option>`).join("");
  $("#setPort").value = st.serial_port || "auto";
  $("#setModel").value = st.openai_model || "gpt-5.5-mini";
  $("#setKey").value = "";
  $("#keyInfo").innerHTML = st.openai_key_env ? "Đang dùng khoá từ biến môi trường OPENAI_API_KEY." : st.openai_key_set ? `Đã lưu khoá: <code>${esc(st.openai_key_hint)}</code> · <a id="clearKey">xoá khoá</a>` : "Chưa có khoá.";
  $("#setTF").value = st.target_finger_counts; $("#setTG").value = st.target_grip_counts;
  if (st.remote) { $("#setAccess").value = ""; $("#setAccess").disabled = true; $("#remoteInfo").textContent = "Bạn đang mở từ xa — chỉ đổi được mật khẩu khi ngồi ở máy tính cắm board."; }
  else { $("#setAccess").disabled = false; $("#setAccess").value = st.access_password || ""; $("#remoteInfo").innerHTML = "Trang Vercel: mở bằng điện thoại / máy khác, nhập mật khẩu này. Đổi mật khẩu thì mọi máy đã đăng nhập phải đăng nhập lại."; }
  S.cal = [...(st.counts_per_kg || [null, null, null, null, null, null])];
  $("#calTable").innerHTML = `<table class="small"><tr><th>Kênh</th><th>Đang đọc</th><th>Số đếm / kg</th><th></th></tr>${[0, 1, 2, 3, 4, 5].map((i) => `<tr><td>${i === 5 ? "Bóp tay" : `Phím ${i + 1} · ${fingerNames()[i]}`}</td><td id="calLive${i}">–</td><td id="calVal${i}">${S.cal[i] ? Math.round(S.cal[i]) : "chưa"}</td><td><button class="btn ghost" data-cal="${i}">Hiệu chuẩn</button> <button class="btn ghost" data-uncal="${i}">Xoá</button></td></tr>`).join("")}</table>`;
  renderConn();
}
function renderCalLive() { for (let i = 0; i < 6; i++) { const e = $(`#calLive${i}`); if (e && S.frame) e.textContent = S.frame.f[i] == null ? "—" : Math.round(forceOf(S.frame, i)); } }
$("#calTable").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.cal) {
    const i = Number(b.dataset.cal), mass = Number($("#calMass").value), v = forceOf(S.frame, i);
    if (!(mass > 0) || v < 200) return toast("Đặt vật lên phím trước (số đọc phải > 200), nhập khối lượng > 0");
    S.cal[i] = v / mass; $(`#calVal${i}`).textContent = Math.round(S.cal[i]); toast("Nhớ bấm Lưu cài đặt");
  }
  if (b.dataset.uncal) { S.cal[Number(b.dataset.uncal)] = null; $(`#calVal${b.dataset.uncal}`).textContent = "chưa"; }
});
document.addEventListener("click", async (e) => {
  if (e.target.id === "clearKey") { await api("/api/settings", { body: { clear_openai_key: true } }); toast("Đã xoá khoá"); loadSettings(); refreshStatus(); }
});
$("#btnSaveSettings").addEventListener("click", async () => {
  const body = {
    serial_port: $("#setPort").value, openai_model: $("#setModel").value.trim() || "gpt-5.5-mini",
    target_finger_counts: Number($("#setTF").value) || 8000, target_grip_counts: Number($("#setTG").value) || 60000, counts_per_kg: S.cal,
  };
  const key = $("#setKey").value.trim(); if (key) body.openai_api_key = key;
  if (!$("#setAccess").disabled && $("#setAccess").value.trim()) body.access_password = $("#setAccess").value.trim();
  try { await api("/api/settings", { body }); toast("✔ Đã lưu cài đặt"); await loadSettings(); await refreshStatus(); } catch (err) { toast(err.message); }
});

async function refreshStatus() { const st = await api("/api/status"); S.status = { ...S.status, ...st }; renderConn(); }

// ------------------------------------------------------------------ nút chung
$("#btnTare").addEventListener("click", () => { cmd("TARE"); toast("Đang đặt 0 — không chạm vào phím…"); });
$("#btnLedTest").addEventListener("click", async () => {
  for (let k = 1; k <= 4; k++) { cmd(`LED ${k} 1`); await new Promise((r) => setTimeout(r, 300)); cmd(`LED ${k} 0`); }
  cmd("LEDS AUTO");
});

// ------------------------------------------------------------------ khởi động
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("/api/login", { body: { password: $("#loginPw").value } });
    localStorage.setItem("rb_token", r.token);
    $("#login").classList.add("hidden");
    $("#loginPw").value = "";
    init();
  } catch (err) { $("#loginErr").textContent = err.message; }
});

async function init() {
  try { await api("/api/status"); } catch (err) { if (err.message !== "Cần đăng nhập") toast(err.message, 5000); if (err.message === "Cần đăng nhập") return; }
  connectStream();
  try {
    S.settings = await api("/api/settings");
    await refreshStatus();
    await loadPatients();
    await refreshPatientData();
  } catch (err) { toast(err.message); }
  renderExGrid();
  S.view = S.view || "overview";
}
init();
