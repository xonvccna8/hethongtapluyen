// Hàm Vercel: trợ lý AI của RehabBoard (ChatGPT qua OpenAI Responses API).
// Biến môi trường trên Vercel (Project → Settings → Environment Variables):
//   OPENAI_API_KEY   khoá OpenAI (bắt buộc)
//   AI_ACCESS_CODE   mã truy cập AI — web phải gửi đúng mã này (để người lạ không dùng hết tiền API)
//   OPENAI_MODEL     tuỳ chọn, mặc định gpt-5.5-mini
// Web gửi: POST /api/ai  header X-AI-Code, body { kind: "analyze" | "chat", context: {...}, messages?: [...] }

const SYSTEM_PROMPT = `Bạn là trợ lý AI của hệ thống RehabBoard AI — thiết bị luyện tập phục hồi chức năng bàn tay theo mô-đun
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
`;
const ANALYZE_FORMAT = `Định dạng (Markdown):
## Tóm tắt
## Điểm tiến bộ
## Cần cải thiện
## Kế hoạch tập tuần tới  (bảng: Bài tập | Cách tập | Số lần | Mục tiêu)
## Lưu ý an toàn
`;

const hits = new Map(); // giới hạn đơn giản theo IP (mỗi máy chủ Vercel giữ riêng)

function tooMany(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 12; // > 12 lần / phút
}

function outputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Chỉ nhận POST" });

  const key = process.env.OPENAI_API_KEY;
  const code = process.env.AI_ACCESS_CODE;
  const model = process.env.OPENAI_MODEL || "gpt-5.5-mini";
  if (!key || !code) return res.status(500).json({ error: "Máy chủ chưa cấu hình OPENAI_API_KEY / AI_ACCESS_CODE trên Vercel" });
  if ((req.headers["x-ai-code"] || "") !== code) return res.status(401).json({ error: "Sai hoặc chưa nhập mã truy cập AI (Cài đặt → Trợ lý AI)" });

  const ip = String(req.headers["x-forwarded-for"] || "?").split(",")[0].trim();
  if (tooMany(ip)) return res.status(429).json({ error: "Hỏi quá nhanh, chờ 1 phút rồi thử lại" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const ctx = JSON.stringify(body.context || {});
  if (ctx.length > 120_000) return res.status(413).json({ error: "Dữ liệu quá lớn" });

  let instructions, input;
  if (body.kind === "chat") {
    const msgs = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ error: "Thiếu câu hỏi" });
    instructions = SYSTEM_PROMPT + "Trả lời ngắn gọn, đúng câu hỏi, dùng Markdown khi cần.";
    input = [
      { role: "user", content: "Số liệu người tập (JSON) để bạn tham khảo khi trả lời:\n" + ctx },
      { role: "assistant", content: "Tôi đã đọc số liệu. Bạn muốn hỏi gì?" },
      ...msgs,
    ];
  } else {
    instructions = SYSTEM_PROMPT + ANALYZE_FORMAT;
    input = [{ role: "user", content: "Đây là hồ sơ và số liệu các buổi tập gần nhất (JSON). Hãy phân tích tiến triển và đưa lời khuyên tập luyện cho tuần tới.\n\n" + ctx }];
  }

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions, input }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data.error && data.error.message) || `HTTP ${r.status}`;
      return res.status(502).json({ error: `OpenAI báo lỗi (model ${model}): ${msg}` });
    }
    return res.status(200).json({ text: outputText(data), model });
  } catch (e) {
    return res.status(502).json({ error: "Không gọi được OpenAI: " + e.message });
  }
};
