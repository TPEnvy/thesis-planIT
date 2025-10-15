// server.js (ESM, clean; Express + Mongoose; no chat/llm endpoints)
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// --------- Config (safe if process may be undefined) ---------
// --------- Config ---------
const env = globalThis?.process?.env ?? {};
const TZ = "Asia/Manila";
const PORT = Number(env.PORT || 5000);

// Prefer env, but fall back to a complete Atlas URL *with* db name
const DB_NAME = env.MONGO_DB || "schedulerApp";
const MONGO_URL =
  env.MONGO_URL ||
  "mongodb+srv://PlanIT_User:Y980PwgoMdMkEIbz@planit.3spmwck.mongodb.net/schedulerApp?retryWrites=true&w=majority&appName=PlanIT";

// --------- MongoDB ---------
mongoose
  .connect(MONGO_URL, {
    dbName: DB_NAME,                  // belt & suspenders
    serverSelectionTimeoutMS: 10000,  // clearer timeout if cluster unreachable
  })
  .then(() => {
    console.log("✅ MongoDB connected");
    console.log("Connected DB name:", mongoose.connection.name);
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --------- App & Middleware ---------
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health check
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// --------- Small utilities ---------
const baseId = (v = "") => {
  const s = String(v || "");
  return s.includes("-") ? s.split("-")[0] : s;
};
const isOid = (v) => mongoose.isValidObjectId(baseId(v));
const asDate = (val) => {
  const d = new Date(val);
  return d instanceof Date && !isNaN(d) ? d : null;
};

// --------- MongoDB ---------
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --------- Schemas ---------
// Replace your userSchema definition with:
const userSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    birthdate: { type: Date },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { timestamps: true } // 👈 adds createdAt, updatedAt
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

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["completed", "missed", null], default: null },

    isRecurring: { type: Boolean, default: false },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Segmentation
    segmentOf: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    segmentIndex: { type: Number, default: null },
  },
  { timestamps: true }
);

eventSchema.index({ userId: 1, start: 1, end: 1 });
eventSchema.index({ segmentOf: 1, segmentIndex: 1 });

// Auto create next-year birthday after save (if recurring)
eventSchema.post("save", async function (doc) {
  try {
    if (!doc?.isRecurring) return;
    if (!String(doc.title || "").includes("Birthday 🎂")) return;

    const now = dayjs().tz(TZ);
    const eventEnd = dayjs(doc.end).tz(TZ);
    if (!eventEnd.isBefore(now, "day")) return;

    const nextBirthday = eventEnd.add(1, "year");
    const exists = await Event.findOne({
      title: doc.title,
      start: nextBirthday.toDate(),
      userId: doc.userId,
    }).lean();

    if (!exists) {
      await Event.create({
        title: doc.title,
        start: nextBirthday.toDate(),
        end: nextBirthday.endOf("day").toDate(),
        importance: "high",
        urgency: "low",
        difficulty: "easy",
        userId: doc.userId,
        isRecurring: true,
      });
    }
  } catch (e) {
    console.warn("Birthday recurrence post-save error:", e.message);
  }
});

const Event = mongoose.model("Event", eventSchema);

const shareRequestSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
  },
  { timestamps: true }
);
const ShareRequest = mongoose.model("ShareRequest", shareRequestSchema);

// --------- AUTH ---------
app.post("/signup", async (req, res) => {
  try {
    const { fullname, email, password, birthdate } = req.body || {};
    if (!fullname || !email || !password) {
      return res.status(400).json({ error: "fullname, email, password are required" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ fullname, email, password: hashedPassword, birthdate });

    // create next birthday event if birthdate provided
    if (birthdate) {
      const now = dayjs().tz(TZ);
      let birthdayNext = dayjs(birthdate).tz(TZ).year(now.year());
      if (birthdayNext.isBefore(now, "day")) birthdayNext = birthdayNext.add(1, "year");
      await Event.create({
        title: `${fullname}'s Birthday 🎂`,
        start: birthdayNext.toDate(),
        end: birthdayNext.endOf("day").toDate(),
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

// Add somewhere after your AUTH routes
app.get("/users/:id", async (req, res) => {
  try {
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: "User not found" });
    res.json({ id: u._id, fullname: u.fullname, email: u.email, createdAt: u.createdAt });
  } catch  {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});


app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid password" });

    res.json({
      message: "Login successful",
      user: { id: user._id, fullname: user.fullname, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// --------- EVENTS ---------

// Get events for a user (owned + shared), scored + ranked
app.get("/events/:userId", async (req, res) => {
  try {
    let { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId required" });
    userId = baseId(userId);

    // 1) fetch events the user owns or that are shared to them
    const events = await Event.find({
      $or: [{ userId }, { sharedWith: userId }],
    }).lean();

    // 2) compute a priority score for each event
    const diffMap = { easy: 3, medium: 2, hard: 1 }; // tweak as you like
    const scored = events.map((e) => {
      const imp = e.importance === "high" ? 2 : 1;
      const urg = e.urgency === "high" ? 2 : 1;
      const diff = diffMap[String(e.difficulty || "medium").toLowerCase()] ?? 2;
      const score = imp * 2 + urg * 2 + diff * 1;
      return { ...e, _score: score };
    });

    // 3) sort by score desc, then by start time asc
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(a.start) - new Date(b.start);
    });

    // 4) add rank numbers starting at 1
    const ranked = scored.map((e, i) => ({ ...e, _rank: i + 1 }));

    res.json(ranked);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: err.message });
  }
});


// Create event with conflict check; allow double-booking via allowDouble flag
app.post("/events", async (req, res) => {
  try {
    const { title, start, end, importance, urgency, userId, difficulty, allowDouble } = req.body || {};
    if (!title || !start || !end || !importance || !urgency || !userId) {
      return res.status(400).json({ error: "All fields required" });
    }

    const s = asDate(start);
    const e = asDate(end);
    if (!s || !e || e <= s) return res.status(400).json({ error: "Invalid date range" });

    const conflict = await Event.findOne({
      userId: baseId(userId),
      start: { $lt: e },
      end: { $gt: s },
    }).lean();

    if (conflict && !allowDouble) {
      return res.status(409).json({ error: "Conflict detected", conflict });
    }

    const event = await Event.create({
      title,
      start: s,
      end: e,
      importance,
      urgency,
      userId: baseId(userId),
      difficulty: difficulty || "medium",
    });

    res.status(201).json(event);
  } catch (err) {
    console.error("Create event error:", err);
    res.status(400).json({ error: err.message });
  }
});



// Update event
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

// Delete event (and any segments)
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

// Update status (completed/missed) with parent/children propagation
app.patch("/events/:id/status", async (req, res) => {
  try {
    let { id } = req.params;
    const { status } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });
    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });

    const validStatuses = ["completed", "missed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    event.status = status;
    await event.save();

    let parentUpdated = false;
    let parent = null;
    let updatedChildIds = [];

    // If child segment completed → complete parent when all children completed
    if (event.segmentOf && status === "completed") {
      const parentId = event.segmentOf;
      const [total, completed] = await Promise.all([
        Event.countDocuments({ segmentOf: parentId }),
        Event.countDocuments({ segmentOf: parentId, status: "completed" }),
      ]);

      if (total > 0 && completed === total) {
        parent = await Event.findByIdAndUpdate(parentId, { status: "completed" }, { new: true });
        parentUpdated = !!parent;
      }
    }

    // If parent completed → cascade "completed" to all children
    if (!event.segmentOf && status === "completed") {
      const children = await Event.find({ segmentOf: event._id }).lean();
      if (children.length > 0) {
        await Event.updateMany(
          { segmentOf: event._id, status: { $ne: "completed" } },
          { $set: { status: "completed" } }
        );
        updatedChildIds = children.map((c) => String(c._id));
      }
    }

    res.json({
      _id: event._id,
      status: event.status,
      message: `Event status updated to ${status}`,
      parentUpdated,
      parent,
      updatedChildIds,
    });
  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

// --------- SHARE REQUESTS ---------

// Create by IDs
app.post("/share-requests", async (req, res) => {
  try {
    const { eventId, senderId, recipientId } = req.body || {};
    if (!eventId || !senderId || !recipientId) {
      return res.status(400).json({ error: "eventId, senderId, recipientId required" });
    }
    const eId = baseId(eventId);
    if (!isOid(eId)) return res.status(400).json({ error: "Invalid eventId" });

    const parentEvent = await Event.findById(eId);
    if (!parentEvent) return res.status(404).json({ error: "Event not found" });

    const request = await ShareRequest.create({
      eventId: eId,
      senderId: baseId(senderId),
      recipientId: baseId(recipientId),
      status: "pending",
    });

    res.status(201).json(request);
  } catch (err) {
    console.error("share-requests create error:", err);
    res.status(400).json({ error: err.message });
  }
});

// Create by emails
app.post("/share-requests/email", async (req, res) => {
  try {
    const { eventId, senderEmail, recipientEmail } = req.body || {};
    if (!eventId || !senderEmail || !recipientEmail) {
      return res.status(400).json({ error: "eventId, senderEmail, recipientEmail required" });
    }
    const eId = baseId(eventId);
    if (!isOid(eId)) return res.status(400).json({ error: "Invalid eventId" });

    const sender = await User.findOne({ email: senderEmail });
    if (!sender) return res.status(404).json({ error: "Sender not found" });

    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });

    const parentEvent = await Event.findById(eId);
    if (!parentEvent) return res.status(404).json({ error: "Event not found" });

    const request = await ShareRequest.create({
      eventId: eId,
      senderId: sender._id,
      recipientId: recipient._id,
      status: "pending",
    });

    res.status(201).json(request);
  } catch (err) {
    console.error("share-requests/email error:", err);
    res.status(400).json({ error: err.message });
  }
});

// Respond to share request (keep / replace / decline)
app.patch("/share-requests/:id/respond", async (req, res) => {
  try {
    let { id } = req.params;
    const { choice } = req.body || {}; // "keep" | "replace" | "decline"

    const reqId = baseId(id);
    let request = null;

    if (isOid(reqId)) {
      request = await ShareRequest.findById(reqId).populate("eventId").populate("recipientId");
    }
    if (!request) {
      if (!isOid(reqId)) return res.status(404).json({ error: "Request not found" });
      request = await ShareRequest.findOne({ eventId: reqId }).populate("eventId").populate("recipientId");
    }
    if (!request) return res.status(404).json({ error: "Request not found" });

    if (choice === "decline") {
      request.status = "declined";
      await request.save();
      return res.json({ message: "Request declined", status: "declined" });
    }

    const src = request.eventId;
    if (!src) return res.status(404).json({ error: "Source event not found" });

    if (choice === "keep") {
      const newEvent = await Event.create({
        title: src.title,
        start: src.start,
        end: src.end,
        importance: src.importance,
        urgency: src.urgency,
        difficulty: src.difficulty,
        userId: request.recipientId._id,
      });
      request.status = "approved";
      await request.save();
      return res.json({ message: "Event kept alongside existing", status: "approved", event: newEvent });
    }

    if (choice === "replace") {
      await Event.deleteMany({
        userId: request.recipientId._id,
        start: { $lt: src.end },
        end: { $gt: src.start },
      });
      const newEvent = await Event.create({
        title: src.title,
        start: src.start,
        end: src.end,
        importance: src.importance,
        urgency: src.urgency,
        difficulty: src.difficulty,
        userId: request.recipientId._id,
      });
      request.status = "approved";
      await request.save();
      return res.json({ message: "Conflicts replaced with incoming", status: "approved", event: newEvent });
    }

    return res.status(400).json({ error: "Invalid choice" });
  } catch (err) {
    console.error("share-requests respond error:", err);
    res.status(500).json({ error: err.message || "Failed to respond" });
  }
});

// Share event by email with conflict info
app.post("/events/:id/share", async (req, res) => {
  try {
    let { id } = req.params;
    const { recipientEmail } = req.body || {};
    if (!recipientEmail) return res.status(400).json({ error: "Recipient email is required" });

    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid event id" });

    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const conflict = await Event.findOne({
      userId: recipient._id,
      start: { $lt: event.end },
      end: { $gt: event.start },
    }).lean();

    const shareRequest = await ShareRequest.create({
      eventId: event._id,
      senderId: event.userId,
      recipientId: recipient._id,
      status: "pending",
    });

    res.json({
      message: `Event shared with ${recipient.email}`,
      shareRequestId: shareRequest._id,
      conflict,
      incoming: event,
    });
  } catch (err) {
    console.error("share by email error:", err);
    res.status(500).json({ error: "Failed to share event" });
  }
});

// List incoming (optionally filtered by status)
app.get("/share-requests/incoming/:recipientId", async (req, res) => {
  try {
    const { recipientId } = req.params;
    const { status } = req.query;
    const q = { recipientId: baseId(recipientId) };
    if (status) q.status = status;

    const requests = await ShareRequest.find(q)
      .sort({ createdAt: -1 })
      .populate("eventId")
      .populate("senderId", "fullname email")
      .lean();

    res.json(requests);
  } catch (err) {
    console.error("incoming share-requests error:", err);
    res.status(500).json({ error: "Failed to fetch incoming share requests" });
  }
});

// --------- SAFE SPLIT (keep parent visible) ---------
app.post("/events/:id/split", async (req, res) => {
  try {
    let { id } = req.params;
    const { mode, count, segmentMinutes, breakMinutes = 0, titlePrefix } = req.body || {};

    id = baseId(id);
    if (!isOid(id)) return res.status(400).json({ error: "Invalid event id" });

    const parent = await Event.findById(id);
    if (!parent) return res.status(404).json({ error: "Parent event not found" });

    const s = asDate(parent.start);
    const e = asDate(parent.end);
    if (!s || !e || !(e > s)) return res.status(400).json({ error: "Invalid parent time range" });

    const totalMinutes = Math.floor((e - s) / (60 * 1000));
    if (totalMinutes <= 0) return res.status(400).json({ error: "Parent has zero/negative duration" });

    let plan = [];

    if (mode === "byCount") {
      const n = Math.max(1, parseInt(count, 10) || 0);
      const brk = Math.max(0, parseInt(breakMinutes, 10) || 0);
      const totalBreaks = (n - 1) * brk;
      const usable = totalMinutes - totalBreaks;
      if (usable <= 0) return res.status(400).json({ error: "Breaks too large for given window" });

      const base = Math.floor(usable / n);
      let remainder = usable % n;

      let cursor = s.getTime();
      for (let i = 0; i < n; i++) {
        const thisDur = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        const segStart = cursor;
        const segEnd = segStart + thisDur * 60 * 1000;
        plan.push({ startMs: segStart, endMs: segEnd });
        cursor = segEnd;
        if (i < n - 1) cursor += brk * 60 * 1000;
      }
    } else if (mode === "byDuration") {
      const len = Math.max(1, parseInt(segmentMinutes, 10) || 0);
      const brk = Math.max(0, parseInt(breakMinutes, 10) || 0);
      let cursor = s.getTime();
      let guard = 0;
      while (cursor < e.getTime() && guard < 10000) {
        guard++;
        const segEnd = Math.min(e.getTime(), cursor + len * 60 * 1000);
        if (segEnd <= cursor) break;
        plan.push({ startMs: cursor, endMs: segEnd });
        cursor = segEnd + brk * 60 * 1000;
      }
      if (plan.length === 0) return res.status(400).json({ error: "No segments fit in the window" });
    } else {
      return res.status(400).json({ error: "mode must be 'byCount' or 'byDuration'" });
    }

    const baseTitle =
      titlePrefix && String(titlePrefix).trim().length ? String(titlePrefix).trim() : parent.title;

    const children = await Promise.all(
      plan.map((slot, i) =>
        Event.create({
          title: `${baseTitle} — Segment ${i + 1}`,
          start: new Date(slot.startMs),
          end: new Date(slot.endMs),
          importance: parent.importance,
          urgency: parent.urgency,
          difficulty: parent.difficulty,
          userId: parent.userId,
          status: null,
          isRecurring: false,
          sharedWith: [],
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

// ===== Dashboard helpers (optional) =====

// Weekly performance: counts completed/missed for last 7 days (PH time),
// OWNED events only, excluding parents that have children (segments).
app.get("/dashboard/weekly/:userId", async (req, res) => {
  try {
    const userId = baseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });

    // find parents that have children
    const children = await Event.find({ segmentOf: { $ne: null } }).select("segmentOf").lean();
    const parentIdsWithChildren = new Set(children.map((c) => String(c.segmentOf)));

    // last 7 days buckets (PH time)
    const today = dayjs().tz(TZ).startOf("day");
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = today.subtract(6 - i, "day");
      return {
        key: d.format("YYYY-MM-DD"),
        day: d.format("ddd"),
        date: d.format("MMM D"),
        completed: 0,
        missed: 0,
      };
    });

    // get owned events updated/ended within last 7 days window
    const windowStart = today.subtract(6, "day").startOf("day").toDate();
    const windowEnd = today.endOf("day").toDate();

    const owned = await Event.find({
      userId,
      end: { $gte: windowStart, $lte: windowEnd },
      status: { $in: ["completed", "missed"] },
    }).lean();

    owned
      .filter((ev) => !parentIdsWithChildren.has(String(ev._id)))
      .forEach((ev) => {
        const key = dayjs(ev.end).tz(TZ).format("YYYY-MM-DD");
        const b = buckets.find((x) => x.key === key);
        if (!b) return;
        if (ev.status === "completed") b.completed += 1;
        if (ev.status === "missed") b.missed += 1;
      });

    res.json(buckets);
  } catch (err) {
    console.error("weekly dashboard error:", err);
    res.status(500).json({ error: "Failed to compute weekly dashboard" });
  }
});

// Upcoming (7 days): owned + shared visible to the user, exclude completed/missed
app.get("/dashboard/upcoming/:userId", async (req, res) => {
  try {
    const userId = baseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });

    const now = dayjs().tz(TZ);
    const in7 = now.add(7, "day").endOf("day").toDate();

    const list = await Event.find({
      $or: [{ userId }, { sharedWith: userId }],
      status: { $in: [null, undefined] },
      end: { $gt: now.toDate() },
      start: { $lt: in7 },
    })
      .sort({ start: 1 })
      .limit(20)
      .lean();

    res.json(list);
  } catch (err) {
    console.error("upcoming dashboard error:", err);
    res.status(500).json({ error: "Failed to fetch upcoming" });
  }
});

// ----- Analytics: weekly productivity (past N weeks) -----
app.get("/analytics/weekly/:userId", async (req, res) => {
  try {
  const { userId } = req.params;
  const limit = Math.max(1, parseInt(req.query.limit || "8", 10));


    // Only look at events that have a final status (completed/missed)
    const pipeline = [
      { $match: { userId: new mongoose.Types.ObjectId(userId), status: { $in: ["completed", "missed"] } } },

      // Truncate start date to the start of the week in Asia/Manila
      {
        $addFields: {
          weekStart: {
            $dateTrunc: {
              date: "$start",
              unit: "week",
              binSize: 1,
              timezone: "Asia/Manila",
              startOfWeek: "mon"
            }
          }
        }
      },

      // Group per weekStart
      {
        $group: {
          _id: "$weekStart",
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          missed:   { $sum: { $cond: [{ $eq: ["$status", "missed"]   }, 1, 0] } },
          total:    { $sum: 1 }
        }
      },

      // Sort newest first and limit
      { $sort: { _id: -1 } },
      { $limit: limit },

      // Shape response + compute score
      {
        $project: {
          _id: 0,
          weekStart: "$_id",
          weekEnd: { $dateAdd: { startDate: "$_id", unit: "day", amount: 6 } },
          completed: 1,
          missed: 1,
          total: 1,
          score: { $subtract: ["$completed", "$missed"] }
        }
      },

      // Return ascending by week for charts
      { $sort: { weekStart: 1 } }
    ];

    const rows = await Event.aggregate(pipeline);

    res.json({
      timezone: "Asia/Manila",
      weeks: rows.map(r => ({
        ...r,
        // labels that are easy to show in UI
        label: `${new Date(r.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(r.weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      }))
    });
  } catch (err) {
    console.error("weekly analytics error:", err);
    res.status(500).json({ error: "Failed to compute weekly analytics" });
  }
});

console.log('Connected DB name:', mongoose.connection.name);


// --------- START SERVER ---------
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
