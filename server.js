// server.js (ESM) — Express + Mongoose + Hugging Face chat + OpenAI (optional)
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dotenv/config";
import { HfInference } from "@huggingface/inference";

dayjs.extend(utc);
dayjs.extend(timezone);

/* ------------------------- Env & Config ------------------------- */
const {
  PORT = 5000,
  TZ = "Asia/Manila",
  MONGO_URL, // must be set in .env
  MONGO_DB = "schedulerApp",

  // (Optional) OpenAI
  OPENAI_API_KEY = "",
  OPENAI_CHAT_MODEL = "gpt-4o-mini",
  OPENAI_EMBED_MODEL = "text-embedding-3-small",

  // Hugging Face
  HF_API_KEY = "",
  HF_CHAT_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1",
  HF_EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2",
} = process.env;

if (!MONGO_URL) {
  console.error("❌ MONGO_URL is not set. Put it in your .env file.");
  process.exit(1);
}

/* -------------------- MongoDB Connection ------------------ */
mongoose
  .connect(MONGO_URL, { dbName: MONGO_DB, serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("✅ MongoDB connected — DB:", mongoose.connection.name))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* -------------------- App & Middleware -------------------- */
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

/* ------------------------ Utilities ----------------------- */
const baseId = (v = "") => String(v || "").split("-")[0];
const isOid = (v) => mongoose.isValidObjectId(baseId(v));
const asDate = (val) => {
  const d = new Date(val);
  return d instanceof Date && !Number.isNaN(d) ? d : null;
};
function meanPool(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return [];
  if (!Array.isArray(matrix[0])) return matrix;
  const rows = matrix.length,
    cols = matrix[0].length;
  const out = Array(cols).fill(0);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j] += matrix[i][j];
  for (let j = 0; j < cols; j++) out[j] /= rows;
  return out;
}
async function withRetry(fn, { tries = 2, delayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/* ------------------------- Schemas ------------------------ */
const userSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    birthdate: { type: Date },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
  },
  { timestamps: true }
);
const User = mongoose.model("User", userSchema);

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    importance: { type: String, enum: ["high", "low"], required: true },
    urgency: { type: String, enum: ["high", "low"], required: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["completed", "missed", null], default: null },

    isRecurring: { type: Boolean, default: false },

    // Segmentation
    segmentOf: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null, index: true },
    segmentIndex: { type: Number, default: null },
  },
  { timestamps: true }
);
eventSchema.index({ userId: 1, start: 1, end: 1 });
eventSchema.index({ segmentOf: 1, segmentIndex: 1 });
const Event = mongoose.model("Event", eventSchema);

/* -------------------------- Auth -------------------------- */
app.post("/signup", async (req, res) => {
  try {
    const { fullname, email, password, birthdate } = req.body || {};
    if (!fullname || !email || !password) {
      return res.status(400).json({ error: "fullname, email, password are required" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ fullname, email, password: hashed, birthdate });

    if (birthdate) {
      const now = dayjs().tz(TZ);
      let bday = dayjs(birthdate).tz(TZ).year(now.year());
      if (bday.isBefore(now, "day")) bday = bday.add(1, "year");
      await Event.create({
        title: `${fullname}'s Birthday 🎂`,
        start: bday.toDate(),
        end: bday.endOf("day").toDate(),
        importance: "high",
        urgency: "low",
        difficulty: "easy",
        userId: user._id,
        isRecurring: true,
      });
    }

    res.json({ id: user._id, fullname: user.fullname, email: user.email });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid password" });
    res.json({ message: "Login successful", user: { id: user._id, fullname: user.fullname, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/users/:id", async (req, res) => {
  try {
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: "User not found" });
    res.json({ id: u._id, fullname: u.fullname, email: u.email, createdAt: u.createdAt });
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.put("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { fullname, email } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid user id" });
    if (!fullname || !email) return res.status(400).json({ error: "fullname and email are required" });

    const existing = await User.findOne({ email, _id: { $ne: id } }).lean();
    if (existing) return res.status(409).json({ error: "Email already in use" });

    const updated = await User.findByIdAndUpdate(id, { fullname, email }, { new: true, runValidators: true }).lean();
    if (!updated) return res.status(404).json({ error: "User not found" });

    res.json({ id: updated._id, fullname: updated.fullname, email: updated.email });
  } catch {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.patch("/users/:id/password", async (req, res) => {
  try {
    const id = req.params.id;
    const { currentPassword, newPassword } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid user id" });
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "currentPassword and newPassword are required" });
    if (String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password updated" });
  } catch {
    res.status(500).json({ error: "Failed to change password" });
  }
});

/* -------------------------- Events ------------------------ */
app.get("/events/:userId", async (req, res) => {
  try {
    let { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId required" });
    userId = baseId(userId);
    const events = await Event.find({ userId }).lean();

    // prioritization score
    const withScore = events.map((e) => {
      const imp = e.importance === "high" ? 3 : 1;
      const urg = e.urgency === "high" ? 2 : 1;
      const diffMap = { easy: 1.1, medium: 1.0, hard: 0.9 };
      const diff = diffMap[String(e.difficulty || "medium")] ?? 1.0;

      const now = dayjs().tz(TZ);
      const minutesUntilStart = Math.max(0, dayjs(e.start).diff(now, "minute"));
      const proximityBoost = 1 / (1 + minutesUntilStart / 180);

      const _score = (imp * 2 + urg * 1.5) * diff + proximityBoost;
      return { ...e, _score };
    });

    withScore.sort((a, b) => (b._score !== a._score ? b._score - a._score : new Date(a.start) - new Date(b.start)));
    const ranked = withScore.map((e, i) => ({ ...e, _rank: i + 1 }));
    res.json(ranked);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/events", async (req, res) => {
  try {
    const { title, start: startRaw, end: endRaw, importance, urgency, userId, difficulty, allowDouble } = req.body || {};
    if (!title || !startRaw || !endRaw || !importance || !urgency || !userId) {
      return res.status(400).json({ error: "All fields required" });
    }
    const s = asDate(startRaw);
    const e = asDate(endRaw);
    if (!s || !e || e <= s) return res.status(400).json({ error: "Invalid date range" });

    if (!allowDouble) {
      const conflict = await Event.findOne({ userId: baseId(userId), start: s, end: e }).lean();
      if (conflict) {
        return res.status(409).json({ error: "Exact duplicate detected", conflict, exact: true });
      }
    }

    const ev = await Event.create({
      title,
      start: s,
      end: e,
      importance: String(importance).toLowerCase(),
      urgency: String(urgency).toLowerCase(),
      difficulty: (difficulty || "medium").toLowerCase(),
      userId: baseId(userId),
    });
    res.status(201).json(ev);
  } catch (err) {
    console.error("Create event error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.put("/events/:id", async (req, res) => {
  try {
    let { id } = req.params;
    if (!id) return res.status(400).json({ error: "id required" });
    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });

    const { start, end } = req.body || {};
    if (start || end) {
      const s = start ? asDate(start) : undefined;
      const e = end ? asDate(end) : undefined;
      if (s && !s.getTime) return res.status(400).json({ error: "Invalid start date" });
      if (e && !e.getTime) return res.status(400).json({ error: "Invalid end date" });
      if (s && e && e <= s) return res.status(400).json({ error: "End must be after start" });
    }

    const updated = await Event.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  } catch (err) {
    console.error("Update event error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.delete("/events/:id", async (req, res) => {
  try {
    let { id } = req.params;
    if (!id) return res.status(400).json({ error: "id required" });
    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });

    const ev = await Event.findById(id).lean();
    if (!ev) return res.json({ message: "Event deleted" });

    await Event.findByIdAndDelete(id);
    await Event.deleteMany({ segmentOf: id });
    res.json({ message: "Event deleted" });
  } catch (err) {
    console.error("Delete event error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.patch("/events/:id/status", async (req, res) => {
  try {
    let { id } = req.params;
    const { status } = req.body || {};
    id = baseId(id);

    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    const valid = ["completed", "missed"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    event.status = status;
    await event.save();

    let parentUpdated = false;
    let parent = null;
    let finalized = false;

    if (event.segmentOf) {
      const parentId = event.segmentOf;
      const children = await Event.find({ segmentOf: parentId }).lean();
      const total = children.length;
      const completed = children.filter((c) => c.status === "completed").length;
      const missed = children.filter((c) => c.status === "missed").length;

      if (completed + missed === total) {
        const finalStatus = missed === 0 ? "completed" : "missed";
        parent = await Event.findByIdAndUpdate(parentId, { status: finalStatus }, { new: true });
        parentUpdated = true;
        finalized = true;
      }
    }

    if (!event.segmentOf && status === "completed") {
      const kids = await Event.find({ segmentOf: event._id, status: null }).lean();
      if (kids.length) {
        await Event.updateMany({ segmentOf: event._id, status: null }, { $set: { status: "completed" } });
        finalized = true;
      }
    }

    res.json({
      _id: event._id,
      status: event.status,
      parentUpdated,
      parent,
      finalized,
      message: finalized ? "Event and/or its segments finalized" : "Event status updated",
    });
  } catch (err) {
    console.error("Status update error", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

/* ------------------- Split (Server is SoT) ------------------- */
app.post("/events/:id/split", async (req, res) => {
  try {
    let { id } = req.params;
    const { count, breakMinutes = 0, titlePrefix, titles } = req.body || {};
    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid event id" });

    const parent = await Event.findById(id);
    if (!parent) return res.status(404).json({ error: "Parent event not found" });

    const s = asDate(parent.start);
    const e = asDate(parent.end);
    if (!s || !e || !(e > s)) return res.status(400).json({ error: "Invalid parent time range" });

    const n = Math.max(1, parseInt(count, 10) || 0);
    if (n < 2) return res.status(400).json({ error: "Nothing to split (count must be >= 2)" });

    const brk = Math.max(0, parseInt(breakMinutes, 10) || 0);

    const totalMinutes = Math.floor((e - s) / 60000);
    const usable = totalMinutes - (n - 1) * brk;
    if (usable <= 0) return res.status(400).json({ error: "Breaks too large for given window" });

    const baseSeg = Math.floor(usable / n);
    let remainder = usable % n;

    const plan = [];
    let cursor = s.getTime();
    for (let i = 0; i < n; i++) {
      const thisDur = baseSeg + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      const segStart = cursor;
      const segEnd = segStart + thisDur * 60000;
      plan.push({ startMs: segStart, endMs: segEnd });
      cursor = segEnd;
      if (i < n - 1) cursor += brk * 60000;
    }

    const baseTitle = titlePrefix && String(titlePrefix).trim().length ? String(titlePrefix).trim() : parent.title;

    const children = await Promise.all(
      plan.map((slot, i) =>
        Event.create({
          title: Array.isArray(titles) && titles[i] && String(titles[i]).trim().length ? String(titles[i]).trim() : `${baseTitle} — Segment ${i + 1}`,
          start: new Date(slot.startMs),
          end: new Date(slot.endMs),
          importance: parent.importance,
          urgency: parent.urgency,
          difficulty: parent.difficulty,
          userId: parent.userId,
          status: null,
          isRecurring: false,
          segmentOf: parent._id,
          segmentIndex: i,
        })
      )
    );

    res.json({ ok: true, parentId: parent._id, segments: children });
  } catch (err) {
    console.error("split error:", err);
    res.status(400).json({ error: err.message || "Failed to split" });
  }
});

/* --------------- Weekly dashboard aggregation --------------- */
app.get("/dashboard/weekly/:userId", async (req, res) => {
  try {
    const userId = baseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });

    const today = dayjs().tz(TZ).startOf("day");
    // find Monday of this week (Mon = start)
    const dow = today.day(); // 0 = Sun, 1 = Mon...
    const monday = today.subtract((dow + 6) % 7, "day").startOf("day");

    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = monday.add(i, "day");
      return { key: d.format("YYYY-MM-DD"), day: d.format("ddd"), date: d.format("MMM D"), completed: 0, missed: 0 };
    });

    const windowStart = monday.toDate();
    const windowEnd = monday.add(6, "day").endOf("day").toDate();

    const pipeline = [
      { $match: { userId: new mongoose.Types.ObjectId(userId), end: { $gte: windowStart, $lte: windowEnd } } },
      {
        $addFields: {
          dayKey: { $dateToString: { date: "$end", timezone: TZ, format: "%Y-%m-%d" } },
          parentId: { $cond: [{ $ifNull: ["$segmentOf", false] }, { $toString: "$segmentOf" }, { $toString: "$_id" }] },
          isChild: { $cond: [{ $ifNull: ["$segmentOf", false] }, true, false] },
          isCompleted: { $eq: ["$status", "completed"] },
        },
      },
      {
        $group: {
          _id: { parentId: "$parentId", dayKey: "$dayKey" },
          totalChildren: { $sum: { $cond: ["$isChild", 1, 0] } },
          completedChildren: { $sum: { $cond: [{ $and: ["$isChild", "$isCompleted"] }, 1, 0] } },
          standaloneCompleted: { $sum: { $cond: [{ $and: [{ $not: "$isChild" }, "$isCompleted"] }, 1, 0] } },
          standaloneTotal: { $sum: { $cond: [{ $not: "$isChild" }, 1, 0] } },
        },
      },
      {
        $project: {
          dayKey: "$_id.dayKey",
          parentCompleted: { $cond: [{ $gt: ["$totalChildren", 0] }, { $cond: [{ $eq: ["$completedChildren", "$totalChildren"] }, 1, 0] }, 0] },
          parentMissed: { $cond: [{ $gt: ["$totalChildren", 0] }, { $cond: [{ $eq: ["$completedChildren", "$totalChildren"] }, 0, 1] }, 0] },
          standaloneCompleted: { $cond: [{ $gt: ["$standaloneTotal", 0] }, "$standaloneCompleted", 0] },
          standaloneMissed: { $cond: [{ $gt: ["$standaloneTotal", 0] }, { $subtract: ["$standaloneTotal", "$standaloneCompleted"] }, 0] },
        },
      },
      { $project: { dayKey: 1, completed: { $add: ["$parentCompleted", "$standaloneCompleted"] }, missed: { $add: ["$parentMissed", "$standaloneMissed"] } } },
      { $group: { _id: "$dayKey", completed: { $sum: "$completed" }, missed: { $sum: "$missed" } } },
      { $project: { _id: 0, dayKey: "$_id", completed: 1, missed: 1 } },
    ];

    const rows = await Event.aggregate(pipeline);
    for (const r of rows) {
      const b = buckets.find((x) => x.key === r.dayKey);
      if (b) {
        b.completed = Number(r.completed || 0);
        b.missed = Number(r.missed || 0);
      }
    }
    res.json(buckets);
  } catch (err) {
    console.error("weekly dashboard error:", err);
    res.status(500).json({ error: "Failed to compute weekly dashboard" });
  }
});

/* ================== HF/OpenAI Proxies ================== */
console.log("HF configured:", Boolean(HF_API_KEY), "chat:", HF_CHAT_MODEL, "embed:", HF_EMBED_MODEL);
console.log("OpenAI configured:", Boolean(OPENAI_API_KEY));

const hf = HF_API_KEY ? new HfInference(HF_API_KEY) : null;

app.post("/api/embed", async (req, res) => {
  try {
    const { provider = "hf", text } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json({ error: "text is required" });

    if (provider === "openai") {
      if (!OPENAI_API_KEY) return res.status(500).json({ error: "OpenAI not configured" });
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ input: text, model: OPENAI_EMBED_MODEL }),
      });
      const txt = await r.text();
      let j;
      try {
        j = JSON.parse(txt);
      } catch {
        j = {};
      }
      if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || "OpenAI embed failed" });
      return res.json({ embedding: j?.data?.[0]?.embedding || [] });
    }

    if (!hf) return res.status(500).json({ error: "Hugging Face not configured" });
    const out = await withRetry(() => hf.featureExtraction({ model: HF_EMBED_MODEL, inputs: text }));
    const embedding = meanPool(out);
    return res.json({ embedding });
  } catch (err) {
    console.error("embed proxy error:", err);
    return res.status(500).json({ error: "Embed proxy failed", detail: String(err?.message || err) });
  }
});

app.post("/api/llm", async (req, res) => {
  try {
    const { provider = "hf", sysPrompt = "", userPrompt = "" } = req.body || {};

    if (provider === "openai") {
      if (!OPENAI_API_KEY) return res.status(500).json({ error: "OpenAI not configured" });
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      const txt = await r.text();
      let j;
      try {
        j = JSON.parse(txt);
      } catch {
        j = {};
      }
      if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || "OpenAI chat failed" });
      const text = j?.choices?.[0]?.message?.content ?? "{}";
      return res.json({ text });
    }

    if (!hf) return res.status(500).json({ error: "Hugging Face not configured" });

    const hfResp = await withRetry(() =>
      hf.chatCompletion({
        model: HF_CHAT_MODEL,
        messages: [
          { role: "system", content: [{ type: "text", text: sysPrompt }] },
          { role: "user", content: [{ type: "text", text: userPrompt }] },
        ],
        temperature: 0.2,
        max_tokens: 512,
      })
    );

    let contentText = "";
    if (Array.isArray(hfResp?.choices) && hfResp.choices[0]?.message?.content) {
      const c = hfResp.choices[0].message.content;
      contentText = Array.isArray(c) ? c.find((p) => p.type === "text")?.text || "" : String(c);
    }
    return res.json({ text: contentText || "{}" });
  } catch (err) {
    console.error("llm proxy error:", err);
    return res.status(500).json({ error: "LLM proxy failed", detail: String(err?.message || err) });
  }
});

/* -------------------------- Chat (LLM-free) -------------------------- */
/**
 * Intents:
 *  - ADD_TASK:   "add task study react november 12 2-4pm urgent somewhat important"
 *  - EDIT_TASK:  "edit study react to nov 13 3-5pm"
 *  - DELETE_TASK:"delete study react"
 *  - SPLIT_TASK: "split study react into 3 with 10m breaks"
 *  - PRODUCTIVITY: "what is my productivity" / "is this a good week"
 *
 * For ADD: if an exact time duplicate exists (same start & end), returns:
 *   intent: "ADD_TASK_CONFLICT",
 *   conflicts: [...],
 *   suggestions: [{start, end, label, hint}, ...],
 *   newEvent: {title,start,end,importance,urgency,difficulty}
 */
app.post("/chat", async (req, res) => {
  try {
    const { userId, text } = req.body || {};
    if (!userId || !text) {
      return res.status(400).json({ error: "userId and text are required" });
    }

    const lower = String(text).trim().toLowerCase();
    const toPH = (d) => dayjs(d).tz(TZ);

    /* ---------------------- Parsing helpers --------------------- */
    const monthMapZero = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    function findMonthDay(str) {
      // e.g. "november 12", "nov 12", "nov 12, 2025"
      const r = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?/i;
      const m = String(str || "").match(r);
      if (!m) return null;
      const monKey = m[1].toLowerCase();
      const day = parseInt(m[2], 10);
      const year = m[3] ? parseInt(m[3], 10) : dayjs().tz(TZ).year();
      const monIdx = monthMapZero[monKey] ?? monthMapZero[monKey.slice(0, 3)];
      if (typeof monIdx !== "number") return null;

      let d = dayjs.tz({ year, month: monIdx, date: day, hour: 0, minute: 0, second: 0, millisecond: 0 }, TZ);
      if (!d.isValid()) return null;
      if (!m[3] && d.isBefore(dayjs().tz(TZ), "day")) d = d.add(1, "year");
      return d.startOf("day");
    }

    function findRelativeDay(str) {
      if (/\bday after tomorrow\b/i.test(str)) return dayjs().tz(TZ).add(2, "day").startOf("day");
      if (/\btomorrow\b/i.test(str)) return dayjs().tz(TZ).add(1, "day").startOf("day");
      if (/\btoday\b/i.test(str)) return dayjs().tz(TZ).startOf("day");
      return null;
    }

    function parseTimeRange(str, baseDay) {
      if (!str) return null;
      // Normalize input
      let s = String(str)
        .replace(/[–—]/g, "-")
        .replace(/\s+to\s+/gi, "-")
        .replace(/\s*-\s*/g, "-")
        .replace(/\bfrom\s+/i, "")
        .trim();

      // Pattern: h(:mm)?(am|pm)? - h(:mm)?(am|pm)?
      const r = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?-(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
      const m = s.match(r);
      if (!m) return null;

      const h1 = parseInt(m[1], 10);
      const min1 = m[2] ? parseInt(m[2], 10) : 0;
      const ap1 = m[3] ? m[3].toLowerCase() : null;

      const h2 = parseInt(m[4], 10);
      const min2 = m[5] ? parseInt(m[5], 10) : 0;
      const ap2 = m[6] ? m[6].toLowerCase() : null;

      const day = baseDay ? dayjs(baseDay).tz(TZ).startOf("day") : dayjs().tz(TZ).startOf("day");

      const to24 = (h, ap) => {
        if (!ap) return h;
        const base = h % 12;
        return ap === "pm" ? base + 12 : base; // 12am -> 0, 12pm -> 12
      };

      let H1 = to24(h1, ap1);
      let H2 = to24(h2, ap2);

      if (ap1 && !ap2 && h2 <= 12) {
        H2 = to24(h2, ap1);
      } else if (!ap1 && ap2 && h1 <= 12) {
        H1 = to24(h1, ap2);
      }

      if (!ap1 && !ap2) {
        const bothUnder13 = H1 <= 12 && H2 <= 12;
        if (bothUnder13 && H2 <= H1) {
          if (H2 + 12 <= 23) H2 += 12;
          if (H2 <= H1 && H1 + 12 <= 23) H1 += 12;
        }
      }

      const start = day.hour(H1).minute(min1).second(0).millisecond(0);
      const end = day.hour(H2).minute(min2).second(0).millisecond(0);
      if (!end.isAfter(start)) return null;
      return { start, end };
    }

    function extractDifficulty(str) {
      if (/\bhard\b/i.test(str)) return "hard";
      if (/\beasy\b/i.test(str)) return "easy";
      return "medium";
    }
    function extractUrgency(str) {
      if (/\burgent\b/i.test(str)) return "high";
      return "low";
    }
    function extractImportance(str) {
      if (/\bimportant\b/i.test(str) && !/\bsomewhat important\b/i.test(str)) return "high";
      return "low";
    }

    function guessTitle(str) {
      let t = String(str || "");

      // Remove command prefixes and common words
      t = t
        .replace(/\b(add\s+(a|an)\s+task|add\s+(a|an)|add\s+task|add|create|make|new|edit|reschedule|move|delete|remove|split)\b/gi, " ")
        .replace(/\b(today|tomorrow|tonight|this morning|this afternoon)\b/gi, " ")
        .replace(/\b(for|on|to|at|my|schedule|what('|’)s|whats|is|please)\b/gi, " ");

      // Remove explicit dates
      t = t
        .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/gi, " ")
        .replace(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g, " ")
        .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ");

      // Remove time ranges
      t = t.replace(/\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to)\s*\d{1,2}(:\d{2})?\s*(am|pm)?/gi, " ").replace(/\b(from)\s+\d{1,2}(:\d{2})?\b/gi, " ");

      // Remove split/break phrases and attributes
      t = t.replace(/\binto\s+\d+\s*(segments?|parts?)\b/gi, " ").replace(/\bwith\s+\d+\s*(m|min|minutes?)\s*breaks?\b/gi, " ");
      t = t.replace(/\b(somewhat\s+important|somewhat\s+urgent|important|urgent|easy|medium|hard)\b/gi, " ");

      // Cleanup
      t = t.replace(/[·•—–"“”'`]/g, " ").replace(/\s+/g, " ").trim();
      t = t.replace(/\b(task|event|activity|meeting|appointment)\b/gi, "").trim();

      if (t.length) t = t.charAt(0).toUpperCase() + t.slice(1);
      return t || "Untitled task";
    }

    function buildSuggestions(conflicts, newEventDurationMin) {
      if (!Array.isArray(conflicts) || conflicts.length === 0) return [];
      const latestEnd = conflicts.reduce((acc, c) => {
        const ce = dayjs(c.end);
        return ce.isAfter(acc) ? ce : acc;
      }, dayjs(conflicts[0].end));
      const now = dayjs().tz(TZ);
      const baseStart = latestEnd.isAfter(now) ? latestEnd : now;

      const dur = Math.max(1, newEventDurationMin);
      const opt1Start = baseStart;
      const opt1End = opt1Start.add(dur, "minute");

      const opt2Start = baseStart.add(1, "hour");
      const opt2End = opt2Start.add(dur, "minute");

      const opt3Start = now.add(1, "day").startOf("day").hour(8).minute(0).second(0);
      const opt3End = opt3Start.add(dur, "minute");

      const fmt = (s, e) =>
        s.isSame(e, "day") ? `${s.format("MMM D, h:mm A")} – ${e.format("h:mm A")}` : `${s.format("MMM D, h:mm A")} – ${e.format("MMM D, h:mm A")}`;

      return [
        { start: opt1Start.toDate(), end: opt1End.toDate(), label: fmt(opt1Start, opt1End), hint: "After conflict" },
        { start: opt2Start.toDate(), end: opt2End.toDate(), label: fmt(opt2Start, opt2End), hint: "+1 hour" },
        { start: opt3Start.toDate(), end: opt3End.toDate(), label: fmt(opt3Start, opt3End), hint: "Tomorrow 8:00 AM" },
      ];
    }

    async function computeWeeklyProductivity(uid) {
      // today in TZ
      const today = dayjs().tz(TZ).startOf("day");

      // compute Monday of current week (Mon = start)
      const dow = today.day(); // 0 = Sun, 1 = Mon, ...
      const monday = today.subtract((dow + 6) % 7, "day").startOf("day");

      // window: Monday 00:00 -> Sunday 23:59:59.999
      const windowStart = monday.toDate();
      const windowEnd = monday.add(6, "day").endOf("day").toDate();

      const pipeline = [
        { $match: { userId: new mongoose.Types.ObjectId(baseId(uid)), end: { $gte: windowStart, $lte: windowEnd } } },
        {
          $addFields: {
            dayKey: { $dateToString: { date: "$end", timezone: TZ, format: "%Y-%m-%d" } },
            parentId: { $cond: [{ $ifNull: ["$segmentOf", false] }, { $toString: "$segmentOf" }, { $toString: "$_id" }] },
            isChild: { $cond: [{ $ifNull: ["$segmentOf", false] }, true, false] },
            isCompleted: { $eq: ["$status", "completed"] },
          },
        },
        {
          $group: {
            _id: { parentId: "$parentId", dayKey: "$dayKey" },
            totalChildren: { $sum: { $cond: ["$isChild", 1, 0] } },
            completedChildren: { $sum: { $cond: [{ $and: ["$isChild", "$isCompleted"] }, 1, 0] } },
            standaloneCompleted: { $sum: { $cond: [{ $and: [{ $not: "$isChild" }, "$isCompleted"] }, 1, 0] } },
            standaloneTotal: { $sum: { $cond: [{ $not: "$isChild" }, 1, 0] } },
          },
        },
        {
          $project: {
            dayKey: "$_id.dayKey",
            parentCompleted: { $cond: [{ $gt: ["$totalChildren", 0] }, { $cond: [{ $eq: ["$completedChildren", "$totalChildren"] }, 1, 0] }, 0] },
            parentMissed: { $cond: [{ $gt: ["$totalChildren", 0] }, { $cond: [{ $eq: ["$completedChildren", "$totalChildren"] }, 0, 1] }, 0] },
            standaloneCompleted: { $cond: [{ $gt: ["$standaloneTotal", 0] }, "$standaloneCompleted", 0] },
            standaloneMissed: { $cond: [{ $gt: ["$standaloneTotal", 0] }, { $subtract: ["$standaloneTotal", "$standaloneCompleted"] }, 0] },
          },
        },
        { $project: { dayKey: 1, completed: { $add: ["$parentCompleted", "$standaloneCompleted"] }, missed: { $add: ["$parentMissed", "$standaloneMissed"] } } },
        { $group: { _id: "$dayKey", completed: { $sum: "$completed" }, missed: { $sum: "$missed" } } },
        { $project: { _id: 0, dayKey: "$_id", completed: 1, missed: 1 } },
      ];

      const rows = await Event.aggregate(pipeline);
      const map = new Map(rows.map((r) => [r.dayKey, r]));

      // Build Monday -> Sunday buckets (7 days)
      const buckets = Array.from({ length: 7 }, (_, i) => {
        const d = monday.add(i, "day");
        const key = d.format("YYYY-MM-DD");
        const row = map.get(key);
        return {
          day: d.format("ddd"),
          date: d.format("MMM D"),
          completed: Number(row?.completed || 0),
          missed: Number(row?.missed || 0),
        };
      });

      const totals = buckets.reduce(
        (acc, b) => {
          acc.completed += b.completed;
          acc.missed += b.missed;
          return acc;
        },
        { completed: 0, missed: 0 }
      );

      const verdict = totals.completed + totals.missed === 0 ? "No data yet." : totals.completed >= Math.max(1, totals.missed) ? "Good week 👍" : "Needs work 👀";

      return { buckets, totals, verdict };
    }

    /* ---------------------- Intent routing ---------------------- */

    // PRODUCTIVITY
    if (/\b(productivity|good week|bad week|weekly)\b/i.test(lower)) {
      const report = await computeWeeklyProductivity(userId);
      const msgLines = [
        `Weekly productivity (this week):`,
        ...report.buckets.map((b) => `• ${b.day} (${b.date}) — ✅ ${b.completed} · ❌ ${b.missed}`),
        ``,
        `Total — ✅ ${report.totals.completed} · ❌ ${report.totals.missed}`,
        `${report.verdict}`,
      ];
      return res.json({
        intent: "PRODUCTIVITY",
        message: msgLines.join("\n"),
        report,
      });
    }

    // ADD_TASK
    if (/^\s*(add\b|add task\b|create\b|make\b|new\b)/i.test(lower)) {
      const dateDay = findMonthDay(text) || findRelativeDay(text) || dayjs().tz(TZ).startOf("day");
      const tr = parseTimeRange(text, dateDay);
      if (!tr) {
        return res.json({
          intent: "ADD_TASK",
          message: "I couldn’t find a valid time range (e.g., 2-4pm).",
        });
      }

      // Enforce end > start (parseTimeRange should already do this, but double-check)
      if (!tr.end.isAfter(tr.start)) {
        return res.json({ intent: "ADD_TASK", message: "Invalid time range: end must be after start." });
      }

      // Prevent scheduling in the past (start must be strictly in the future)
      const nowPH = dayjs().tz(TZ);
      if (!tr.start.isAfter(nowPH)) {
        return res.json({
          intent: "ADD_TASK",
          message: "I can't add an event that starts in the past. Please choose a future start time.",
        });
      }

      const title = guessTitle(text) || "New task";
      const importance = extractImportance(text);
      const urgency = extractUrgency(text);
      const difficulty = extractDifficulty(text);

      // conflict check (exact same start+end for this user)
      const conflict = await Event.findOne({
        userId: baseId(userId),
        start: tr.start.toDate(),
        end: tr.end.toDate(),
      }).lean();

      if (conflict) {
        const durMin = Math.max(1, tr.end.diff(tr.start, "minute"));
        const suggestions = buildSuggestions([conflict], durMin);
        const msg = [
          `Exact time conflict with “${conflict.title}” (${toPH(conflict.start).format("MMM D, h:mm A")} – ${toPH(conflict.end).format("h:mm A")}).`,
          `Here are some suggestions:`,
          ...suggestions.map((s) => `• ${s.label} (${s.hint})`),
          `Reply like: “reschedule ${title} to <one of the suggestions>”`,
        ].join("\n");
        return res.json({
          intent: "ADD_TASK_CONFLICT",
          message: msg,
          conflicts: [conflict],
          suggestions,
          newEvent: {
            title,
            start: tr.start.toDate(),
            end: tr.end.toDate(),
            importance,
            urgency,
            difficulty,
          },
        });
      }

      const ev = await Event.create({
        title,
        start: tr.start.toDate(),
        end: tr.end.toDate(),
        importance,
        urgency,
        difficulty,
        userId: baseId(userId),
      });

      return res.json({
        intent: "ADD_TASK",
        message: `Added “${ev.title}” on ${toPH(ev.start).format("MMM D, h:mm A")} – ${toPH(ev.end).format("h:mm A")}.`,
        event: ev,
      });
    }

    // EDIT_TASK
    if (/\b(edit|reschedule|move)\b/i.test(lower)) {
      const titleGuess = guessTitle(text);
      if (!titleGuess) {
        return res.json({ intent: "EDIT_TASK", message: "Which task should I edit?" });
      }
      const ev = await Event.findOne({
        userId: baseId(userId),
        title: { $regex: new RegExp(titleGuess.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        status: null,
      }).sort({ start: -1 });

      if (!ev) {
        return res.json({ intent: "EDIT_TASK", message: `I can’t find a task matching “${titleGuess}”.` });
      }

      const dateDay = findMonthDay(text) || findRelativeDay(text) || dayjs(ev.start).tz(TZ).startOf("day");
      const tr = parseTimeRange(text, dateDay);
      if (!tr) {
        return res.json({
          intent: "EDIT_TASK",
          message: "I couldn’t find the new time range (e.g., 3-5pm).",
        });
      }

      // exact time conflict check against *other* events
      const exactConflict = await Event.findOne({
        userId: baseId(userId),
        _id: { $ne: ev._id },
        start: tr.start.toDate(),
        end: tr.end.toDate(),
      }).lean();

      if (exactConflict) {
        const durMin = Math.max(1, tr.end.diff(tr.start, "minute"));
        const suggestions = buildSuggestions([exactConflict], durMin);
        const msg = [
          `That new time exactly conflicts with “${exactConflict.title}”.`,
          `Suggestions:`,
          ...suggestions.map((s) => `• ${s.label} (${s.hint})`),
        ].join("\n");
        return res.json({
          intent: "EDIT_TASK_CONFLICT",
          message: msg,
          conflicts: [exactConflict],
          suggestions,
          target: { id: ev._id, title: ev.title },
        });
      }

      ev.start = tr.start.toDate();
      ev.end = tr.end.toDate();
      ev.urgency = extractUrgency(text) || ev.urgency;
      ev.importance = extractImportance(text) || ev.importance;
      ev.difficulty = extractDifficulty(text) || ev.difficulty;
      await ev.save();

      return res.json({
        intent: "EDIT_TASK",
        message: `Rescheduled “${ev.title}” to ${toPH(ev.start).format("MMM D, h:mm A")} – ${toPH(ev.end).format("h:mm A")}.`,
        event: ev,
      });
    }

    /* ------------------- NEW: MARK (complete/missed) -------------------
       Recognizes forms like:
         - "mark complete segment 2 of study react"
         - "marked complete segment 2 of study react"
         - "mark segment 2 complete for study react"
         - "mark study react complete"
       Behavior:
         - If user references a parent: mark the parent (and finalize children if applicable)
         - If user references a segment number + parent: mark that child only
         - segment numbers are interpreted as 1-based (user says "segment 2" -> segmentIndex 1)
       New rule:
         - marking as "completed" is allowed only if the event's `end` is <= now (in TZ).
         - marking as "missed" is allowed anytime.
    -------------------------------------------------------------------- */
    if (/\b(mark(?:ed)?|set)\b/i.test(lower) && /\b(complete|completed|missed|incomplete)\b/i.test(lower)) {
      // helper for regex escaping
      const escapeRegExp = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Normalize status words
      const statusMatch = lower.match(/\b(complete|completed|missed|incomplete)\b/);
      let desiredStatus = statusMatch ? statusMatch[1] : null;
      if (desiredStatus === "incomplete") desiredStatus = "missed"; // treat "incomplete" as missed for status
      if (desiredStatus === "completed") desiredStatus = "completed";
      if (desiredStatus === "complete") desiredStatus = "completed";

      // only proceed if status recognized
      if (["completed", "missed"].includes(desiredStatus)) {
        const nowPH = dayjs().tz(TZ);

        // try patterns in order

        // 1) pattern: "segment N of <title> ..."
        let segPattern = /\bsegment\s+(\d{1,3})\s+(?:of|for)\s+(.+?)\b(?:$|[.,;!])/i;
        let m = String(text || "").match(segPattern);
        if (!m) {
          // also accept "segment 2 study react" or "segment 2 complete study react"
          segPattern = /\bsegment\s+(\d{1,3})\s+(.+?)\b(?:$|[.,;!])/i;
          m = String(text || "").match(segPattern);
        }

        if (m) {
          // segment-specific command
          const segNum = parseInt(m[1], 10);
          const segIndex = Math.max(0, segNum - 1); // user -> 1-based to 0-based
          const titlePhrase = (m[2] || "").trim();

          // build title guess (reuse guessTitle but keep original capitalization/trimming)
          const titleGuess = guessTitle(titlePhrase) || titlePhrase;

          // find parent (segmentOf == null) matching the guess
          const uid = baseId(userId);
          let parent = await Event.findOne({
            userId: uid,
            segmentOf: null,
            title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
          }).sort({ start: -1 });

          if (!parent) {
            // try tokenized AND-match
            const tokens = titleGuess.split(/\s+/).filter(Boolean);
            if (tokens.length) {
              parent = await Event.findOne({
                userId: uid,
                segmentOf: null,
                $and: tokens.map((t) => ({ title: { $regex: new RegExp(escapeRegExp(t), "i") } })),
              }).sort({ start: -1 });
            }
          }

          // if still not found, maybe user referenced a child title; find a child then resolve parent
          if (!parent) {
            const child = await Event.findOne({
              userId: uid,
              title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
              segmentOf: { $ne: null },
            }).sort({ start: -1 });
            if (child) parent = await Event.findById(child.segmentOf);
          }

          if (!parent) {
            return res.json({ intent: "MARK_SEGMENT", message: `I can't find a parent task matching "${titlePhrase}".` });
          }

          // find the child with given segmentIndex
          const child = await Event.findOne({ segmentOf: parent._id, segmentIndex: segIndex, userId: parent.userId }).sort({ start: 1 });
          if (!child) {
            // fallback: maybe user counted from 1 but segments stored differently — try ordered list
            const children = await Event.find({ segmentOf: parent._id }).sort({ segmentIndex: 1, start: 1 }).lean();
            if (!children || !children.length) {
              return res.json({ intent: "MARK_SEGMENT", message: `No segments found for “${parent.title}”.` });
            }
            if (segIndex < 0 || segIndex >= children.length) {
              return res.json({ intent: "MARK_SEGMENT", message: `Segment ${segNum} not found for “${parent.title}” (there are ${children.length} segment(s)).` });
            }
            // pick by position
            const chosen = children[segIndex];

            // check end-time rule for completed
            if (desiredStatus === "completed") {
              const chosenEnd = dayjs(chosen.end).tz(TZ);
              if (chosenEnd.isAfter(nowPH)) {
                return res.json({
                  intent: "MARK_SEGMENT",
                  message: `Cannot mark segment ${segNum} of “${parent.title}” as completed — it ends at ${chosenEnd.format("MMM D, h:mm A")} (still in the future).`,
                });
              }
            }

            await Event.findByIdAndUpdate(chosen._id, { status: desiredStatus });
            // After marking, finalize parent if applicable
            const allChildren = await Event.find({ segmentOf: parent._id }).lean();
            const completed = allChildren.filter((c) => c.status === "completed").length;
            const missed = allChildren.filter((c) => c.status === "missed").length;
            if (completed + missed === allChildren.length) {
              const finalStatus = missed === 0 ? "completed" : "missed";
              await Event.findByIdAndUpdate(parent._id, { status: finalStatus });
              return res.json({ intent: "MARK_SEGMENT", message: `Marked segment ${segNum} of “${parent.title}” as ${desiredStatus}. Parent finalized as ${finalStatus}.` });
            }
            return res.json({ intent: "MARK_SEGMENT", message: `Marked segment ${segNum} of “${parent.title}” as ${desiredStatus}.` });
          }

          // check end-time rule for completed for found child
          if (desiredStatus === "completed") {
            const childEnd = dayjs(child.end).tz(TZ);
            if (childEnd.isAfter(nowPH)) {
              return res.json({
                intent: "MARK_SEGMENT",
                message: `Cannot mark segment ${segNum} of “${parent.title}” as completed — it ends at ${childEnd.format("MMM D, h:mm A")} (still in the future).`,
              });
            }
          }

          // update the found child
          child.status = desiredStatus;
          await child.save();

          // After marking, finalize parent if all children resolved
          const siblings = await Event.find({ segmentOf: parent._id }).lean();
          const total = siblings.length;
          const completedCnt = siblings.filter((c) => c.status === "completed").length;
          const missedCnt = siblings.filter((c) => c.status === "missed").length;
          if (completedCnt + missedCnt === total) {
            const finalStatus = missedCnt === 0 ? "completed" : "missed";
            await Event.findByIdAndUpdate(parent._id, { status: finalStatus });
            return res.json({
              intent: "MARK_SEGMENT",
              message: `Marked segment ${segNum} of “${parent.title}” as ${desiredStatus}. Parent finalized as ${finalStatus}.`,
            });
          }

          return res.json({
            intent: "MARK_SEGMENT",
            message: `Marked segment ${segNum} of “${parent.title}” as ${desiredStatus}.`,
            segment: child,
            parentId: parent._id,
          });
        }

        // 2) pattern: "mark <title> complete" -> mark parent (and, if parent has unresolved segments, optionally mark all children)
        // extract probable title phrase by removing "mark/marked" and "complete/missed"
        const cleaned = String(text || "")
          .replace(/\b(marked|mark|set)\b/gi, " ")
          .replace(/\b(complete|completed|missed|incomplete)\b/gi, " ")
          .replace(/\b(as)\b/gi, " ")
          .trim();
        const titleGuess = guessTitle(cleaned) || cleaned;

        if (titleGuess) {
          const uid = baseId(userId);
          let parent = await Event.findOne({
            userId: uid,
            segmentOf: null,
            title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
          }).sort({ start: -1 });

          if (!parent) {
            const tokens = titleGuess.split(/\s+/).filter(Boolean);
            if (tokens.length) {
              parent = await Event.findOne({
                userId: uid,
                segmentOf: null,
                $and: tokens.map((t) => ({ title: { $regex: new RegExp(escapeRegExp(t), "i") } })),
              }).sort({ start: -1 });
            }
          }

          if (!parent) {
            // maybe user addressed a child directly
            const child = await Event.findOne({
              userId: uid,
              title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
              segmentOf: { $ne: null },
            }).sort({ start: -1 });
            if (child) parent = await Event.findById(child.segmentOf);
          }

          if (!parent) {
            return res.json({ intent: "MARK", message: `I can’t find a parent task matching “${titleGuess}”.` });
          }

          // If parent has children and the request is to mark completed,
          // ensure all children (or at least the ones to be marked) have already ended.
          const kids = await Event.find({ segmentOf: parent._id }).sort({ segmentIndex: 1, start: 1 }).lean();

          if (desiredStatus === "completed") {
            // If parent has children, verify that every child (or unresolved child to be marked) has ended.
            const futureKids = kids.filter((k) => dayjs(k.end).tz(TZ).isAfter(nowPH));
            if (futureKids.length) {
              // return list of segments that are still in the future
              const sampleList = futureKids
                .slice(0, 6)
                .map((k) => {
                  const idx = typeof k.segmentIndex === "number" ? k.segmentIndex + 1 : "?";
                  return `segment ${idx} (ends ${dayjs(k.end).tz(TZ).format("MMM D, h:mm A")})`;
                })
                .join(", ");
              return res.json({
                intent: "MARK",
                message: `Cannot mark “${parent.title}” completed because some segment(s) are still in the future: ${sampleList}. Mark as missed or wait until they end.`,
              });
            }

            // If no children (standalone) or all children ended, mark them
            if (kids.length) {
              await Event.updateMany({ segmentOf: parent._id }, { $set: { status: "completed" } });
            } else {
              // standalone: check parent's end
              const parentEnd = dayjs(parent.end).tz(TZ);
              if (parentEnd.isAfter(nowPH)) {
                return res.json({
                  intent: "MARK",
                  message: `Cannot mark “${parent.title}” as completed — it ends at ${parentEnd.format("MMM D, h:mm A")} (still in the future).`,
                });
              }
            }
          } else if (desiredStatus === "missed") {
            // marking missed allowed anytime; mark unresolved children as missed
            if (kids.length) {
              await Event.updateMany({ segmentOf: parent._id, status: null }, { $set: { status: "missed" } });
            }
          }

          // finally mark parent status
          parent.status = desiredStatus;
          await parent.save();

          return res.json({
            intent: "MARK",
            message: `Marked “${parent.title}” and its ${kids.length} unresolved segment(s) as ${desiredStatus}.`,
            parentId: parent._id,
          });
        }
      }
      // If we got here and didn't return, let other handlers handle the message (fallback)
    }

    /* ---------- DELETE (single event OR segments) ---------- */
    if (/\b(delete|remove)\b/i.test(lower)) {
      // Improved guessTitle for delete
      function guessTitleForDelete(str) {
        let t = String(str || "");

        t = t
          .replace(/\b(add\s+(a\s+)?task|add|create|make|new|edit|reschedule|move|delete|remove|split)\b/gi, " ")
          .replace(/\b(today|tomorrow)\b/gi, " ")
          .replace(/\b(for|on|to|at|my|schedule|what('|’)s|whats|is|of)\b/gi, " ")
          .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/gi, " ")
          .replace(/\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to)\s*\d{1,2}(:\d{2})?\s*(am|pm)?/gi, " ")
          .replace(/\b(segments?|parts?)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        t = t.replace(/\b(task|event|activity)\b/gi, "").trim();

        if (t.length) t = t.charAt(0).toUpperCase() + t.slice(1);
        return t || "";
      }
      

      const escapeRegExp = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      try {
        const uid = baseId(userId);

        // detect "segments" intent (various wordings)
        const isSegmentsCmd = /\bsegments?\b/i.test(lower) || /\bparts?\b/i.test(lower);

        // try to extract the phrase that likely contains the task title
        let titlePhrase = null;
        let m = String(text || "").match(/\bdelete\b\s+(?:segments?|parts?)\s+(?:of|for)\s+(.+)$/i);
        if (m && m[1]) titlePhrase = m[1].trim();
        if (!titlePhrase) {
          m = String(text || "").match(/\bdelete\b\s+(.+?)\s+(?:segments?|parts?)$/i);
          if (m && m[1]) titlePhrase = m[1].trim();
        }
        if (!titlePhrase) {
          m = String(text || "").match(/\bdelete\b\s+(?:the\s+)?(.+)$/i) || String(text || "").match(/\bremove\b\s+(?:the\s+)?(.+)$/i);
          if (m && m[1]) titlePhrase = m[1].trim();
        }

        const titleGuess = guessTitleForDelete(titlePhrase || text);
        if (!titleGuess) {
          return res.json({
            intent: isSegmentsCmd ? "DELETE_SEGMENTS" : "DELETE_TASK",
            message: isSegmentsCmd ? "Which task’s segments should I delete? e.g. `delete segments of study react`" : "Which task should I delete? e.g. `delete study react`",
          });
        }

        // Try to find a parent (segmentOf == null) matching the guess
        let parent = await Event.findOne({
          userId: uid,
          segmentOf: null,
          title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
        }).sort({ start: -1 });

        // If parent not found, try tokenized AND-match
        if (!parent) {
          const tokens = titleGuess.split(/\s+/).filter(Boolean);
          if (tokens.length) {
            parent = await Event.findOne({
              userId: uid,
              segmentOf: null,
              $and: tokens.map((t) => ({ title: { $regex: new RegExp(escapeRegExp(t), "i") } })),
            }).sort({ start: -1 });
          }
        }

        // If still not found, maybe user referenced a child segment — find child then resolve parent
        if (!parent) {
          const child = await Event.findOne({
            userId: uid,
            title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
            segmentOf: { $ne: null },
          }).sort({ start: -1 });

          if (child) {
            parent = await Event.findById(child.segmentOf);
          }
        }

        // Now branch on segments-vs-single-delete intent
        if (isSegmentsCmd) {
          if (!parent) {
            return res.json({ intent: "DELETE_SEGMENTS", message: `I can’t find a parent task matching “${titleGuess}”.` });
          }
          const deleted = await Event.deleteMany({ segmentOf: parent._id });
          return res.json({
            intent: "DELETE_SEGMENTS",
            message: `Deleted ${deleted.deletedCount || 0} segment(s) for “${parent.title}”.`,
            parentId: parent._id,
            deletedCount: deleted.deletedCount || 0,
          });
        }

        // Non-segments delete: try to delete a single matching event (prefer exact/closest)
        let ev = await Event.findOne({
          userId: uid,
          title: { $regex: new RegExp("^\\s*" + escapeRegExp(titleGuess) + "\\s*$", "i") },
        }).sort({ start: -1 });

        if (!ev) {
          ev = await Event.findOne({
            userId: uid,
            title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
          }).sort({ start: -1 });
        }

        if (!ev) {
          const tokens = titleGuess.split(/\s+/).filter(Boolean);
          if (tokens.length) {
            ev = await Event.findOne({
              userId: uid,
              $and: tokens.map((t) => ({ title: { $regex: new RegExp(escapeRegExp(t), "i") } })),
            }).sort({ start: -1 });
          }
        }

        if (!ev) {
          const child = await Event.findOne({
            userId: uid,
            title: { $regex: new RegExp(escapeRegExp(titleGuess), "i") },
            segmentOf: { $ne: null },
          }).sort({ start: -1 });
          if (child) ev = child;
        }

        if (!ev) {
          return res.json({ intent: "DELETE_TASK", message: `I can’t find a task matching “${titleGuess}”.` });
        }

        if (ev.segmentOf) {
          await Event.deleteOne({ _id: ev._id });
          return res.json({ intent: "DELETE_TASK", message: `Deleted segment “${ev.title}”.` });
        }

        const delParent = await Event.deleteOne({ _id: ev._id });
        const delChildren = await Event.deleteMany({ segmentOf: ev._id });
        return res.json({
          intent: "DELETE_TASK",
          message: `Deleted “${ev.title}” and ${delChildren.deletedCount || 0} segment(s).`,
          deletedParent: Boolean(delParent.deletedCount && delParent.deletedCount > 0),
          deletedSegments: delChildren.deletedCount || 0,
        });
      } catch (err) {
        console.error("DELETE handler error:", err);
        return res.status(500).json({ intent: "DELETE_TASK", error: "Failed to perform delete" });
      }
    }

    // SPLIT_TASK
    if (/\bsplit\b/i.test(lower)) {
      const titleGuess = guessTitle(text);
      if (!titleGuess) {
        return res.json({ intent: "SPLIT_TASK", message: "Which task should I split?" });
      }
      const ev = await Event.findOne({
        userId: baseId(userId),
        title: { $regex: new RegExp(titleGuess.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        status: null,
      }).sort({ start: -1 });

      if (!ev) {
        return res.json({ intent: "SPLIT_TASK", message: `I can’t find a task matching “${titleGuess}”.` });
      }

      const mCount = lower.match(/\binto\s+(\d{1,2})\b/);
      const count = Math.max(2, mCount ? parseInt(mCount[1], 10) : 2);
      const mBreak = lower.match(/\bwith\s+(\d{1,3})\s*(m|min|minutes?)\s*break/i);
      const breakMinutes = mBreak ? parseInt(mBreak[1], 10) : 0;

      const s = new Date(ev.start);
      const e = new Date(ev.end);
      const totalMinutes = Math.floor((e - s) / 60000);
      const usable = totalMinutes - (count - 1) * breakMinutes;
      if (usable <= 0) {
        return res.json({ intent: "SPLIT_TASK", message: "Breaks too large for the window." });
      }
      // === RE-ADDED: enforce 3-hour minimum before allowing a split ===
      if (totalMinutes < 180) {
        return res.status(400).json({ error: "Event/Task must be at least 3 hours (180 minutes) to split." });
      }

      const baseSeg = Math.floor(usable / count);
      let remainder = usable % count;

      const plan = [];
      let cursor = s.getTime();
      for (let i = 0; i < count; i++) {
        const thisDur = baseSeg + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        const segStart = cursor;
        const segEnd = segStart + thisDur * 60000;
        plan.push({ startMs: segStart, endMs: segEnd });
        cursor = segEnd;
        if (i < count - 1) cursor += breakMinutes * 60000;
      }

      const baseTitle = ev.title;
      const children = await Promise.all(
        plan.map((slot, i) =>
          Event.create({
            title: `${baseTitle} — Segment ${i + 1}`,
            start: new Date(slot.startMs),
            end: new Date(slot.endMs),
            importance: ev.importance,
            urgency: ev.urgency,
            difficulty: ev.difficulty,
            userId: ev.userId,
            status: null,
            isRecurring: false,
            segmentOf: ev._id,
            segmentIndex: i,
          })
        )
      );

      return res.json({
        intent: "SPLIT_TASK",
        message: `Split “${ev.title}” into ${children.length} segment(s).`,
        segments: children,
      });
    }

    // SCHEDULE intent (robust)
    function parseRequestedDate(text) {
      if (!text) return null;
      let s = String(text || "").toLowerCase().trim();
      s = s.replace(/([0-9])(st|nd|rd|th)\b/g, "$1");
      s = s.replace(/[.,]/g, " ");
      s = s.replace(/\b(for|on|schedule|show|what's|whats|is my|what is)\b/gi, " ");
      s = s.replace(/\s+/g, " ");
      s = s.replace(/([a-z])(\d)/gi, "$1 $2");

      if (/\bday after tomorrow\b/.test(s)) return dayjs().tz(TZ).add(2, "day").startOf("day");
      if (/\btomorrow\b/.test(s)) return dayjs().tz(TZ).add(1, "day").startOf("day");
      if (/\btoday\b/.test(s)) return dayjs().tz(TZ).startOf("day");

      const iso = s.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
      if (iso) {
        const y = parseInt(iso[1], 10);
        const mo = parseInt(iso[2], 10);
        const dd = parseInt(iso[3], 10);
        const isoStr = `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00`;
        const d = dayjs.tz(isoStr, TZ);
        if (d.isValid()) return d.startOf("day");
      }

      const monthRe = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+(\d{4}))?\b/i;
      const m = s.match(monthRe);
      if (m) {
        const monthKey = m[1].toLowerCase();
        const dayNum = parseInt(m[2], 10);
        const year = m[3] ? parseInt(m[3], 10) : dayjs().tz(TZ).year();

        const monthMapOne = {
          jan: 1,
          january: 1,
          feb: 2,
          february: 2,
          mar: 3,
          march: 3,
          apr: 4,
          april: 4,
          may: 5,
          jun: 6,
          june: 6,
          jul: 7,
          july: 7,
          aug: 8,
          august: 8,
          sep: 9,
          sept: 9,
          september: 9,
          oct: 10,
          october: 10,
          nov: 11,
          november: 11,
          dec: 12,
          december: 12,
        };

        const monthOneBased = monthMapOne[monthKey] ?? monthMapOne[monthKey.slice(0, 3)];
        if (typeof monthOneBased === "number") {
          const isoStr = `${year}-${String(monthOneBased).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}T00:00:00`;
          let d = dayjs.tz(isoStr, TZ);
          if (!d.isValid()) return null;
          if (!m[3]) {
            const today = dayjs().tz(TZ).startOf("day");
            if (d.isBefore(today, "day")) d = d.add(1, "year");
          }
          return d.startOf("day");
        }
      }

      // fallback numeric like "11-10" or "11/10"
      const smallDate = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
      if (smallDate) {
        const a = parseInt(smallDate[1], 10);
        const b = parseInt(smallDate[2], 10);
        const y = smallDate[3] ? parseInt(smallDate[3], 10) : dayjs().tz(TZ).year();
        // assume mm-dd
        const isoStr = `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}T00:00:00`;
        const d = dayjs.tz(isoStr, TZ);
        if (d.isValid()) return d.startOf("day");
      }

      return null;
    }

    if (/\b(schedule|my schedule|what('?| i)s my schedule|what's scheduled|show schedule|what(?:'s| is) scheduled)\b/i.test(lower)) {
      const requestedDay = parseRequestedDate(text) || parseRequestedDate(lower);
      let targetDay = requestedDay || (/\btomorrow\b/i.test(lower) ? dayjs().tz(TZ).add(1, "day").startOf("day") : dayjs().tz(TZ).startOf("day"));

      console.log("Parsed schedule request:", { raw: text, parsed: targetDay.format() });

      const dayStart = dayjs(targetDay).tz(TZ).startOf("day").toDate();
      const dayEnd = dayjs(targetDay).tz(TZ).endOf("day").toDate();

      const events = await Event.find({
        userId: new mongoose.Types.ObjectId(baseId(userId)),
        $or: [{ start: { $gte: dayStart, $lte: dayEnd } }, { end: { $gte: dayStart, $lte: dayEnd } }, { start: { $lte: dayStart }, end: { $gte: dayEnd } }],
      })
        .sort({ start: 1 })
        .lean();

      const label = dayjs(targetDay).tz(TZ).format("ddd, MMM D, YYYY");
      if (!events?.length) {
        return res.json({
          intent: "SCHEDULE",
          message: `No tasks found for ${label}.`,
          date: targetDay.toDate(),
          events: [],
        });
      }

      const lines = events.map((ev) => {
        const s = dayjs(ev.start).tz(TZ).format("h:mm A");
        const e = dayjs(ev.end).tz(TZ).format("h:mm A");
        const attrs = [];
        if (ev.importance === "high") attrs.push("important");
        if (ev.urgency === "high") attrs.push("urgent");
        if (ev.difficulty && ev.difficulty !== "medium") attrs.push(ev.difficulty);
        const attrText = attrs.length ? ` • ${attrs.join(", ")}` : "";
        return `• ${s}–${e} — ${ev.title}${attrText}`;
      });

      return res.json({
        intent: "SCHEDULE",
        message: [`Schedule for ${label}:`, ...lines].join("\n"),
        date: targetDay.toDate(),
        events,
      });
    }

    // Fallback (help)
    return res.json({
      intent: "UNKNOWN",
      message:
        "I can add/edit/delete/split tasks, and report productivity.\nTry:\n• add task study react november 12 2-4pm urgent somewhat important\n• edit study react to nov 13 3-5pm\n• delete study react\n• split study react into 3 with 10m breaks\n• what's my productivity\n• what's my schedule tomorrow\n• schedule for nov 10",
    });
  } catch (err) {
    console.error("POST /chat error:", err.stack || err);
    res.status(500).json({ error: "Chat handler failed" });
  }
});

/* ---------------------- Start server ---------------------- */
app.listen(Number(PORT), () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
