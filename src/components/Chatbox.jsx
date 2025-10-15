// Chatbox.jsx — Tailwind, fetch-only, no auth inside (expects `user` prop)
// Commands: add, edit, delete/remove, share, split, mark, show/list
// Props:
//   - apiBase (e.g. "http://localhost:5000")
//   - user   ({ id, email, fullname })  <-- REQUIRED
//   - onEventsUpdated?: (events) => void

import React, { useEffect, useMemo, useRef, useState } from "react";

// ---------------- utils ----------------
function smartSplit(input) {
  const out = [];
  let curr = "";
  let q = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!q && (ch === '"' || ch === "'")) {
      if (curr.trim()) { out.push(curr); curr = ""; }
      q = ch; continue;
    }
    if (q && ch === q) { out.push(curr); curr = ""; q = null; continue; }
    if (!q && /\s/.test(ch)) {
      if (curr.trim()) { out.push(curr); curr = ""; }
    } else curr += ch;
  }
  if (curr.trim()) out.push(curr);
  return out;
}
function isObjectId(str) {
  return /^[a-f0-9]{24}$/i.test(String(str || "").trim());
}
function parseDateKeyword(word) {
  const w = String(word || "").toLowerCase();
  if (w === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  if (w === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  return null;
}
function toISO(dateStr, timeHHmm) {
  const m = String(timeHHmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}
function resolveEventId(query, events) {
  if (!query) return null;
  if (isObjectId(query)) return query;
  const q = String(query).toLowerCase();
  const found = events.find((e) => String(e.title || "").toLowerCase() === q);
  return found ? String(found._id) : null;
}

// ---------------- fetch client ----------------
function useApi(baseURL) {
  return useMemo(() => {
    const base =
      (baseURL || import.meta?.env?.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
    async function doFetch(path, { method = "GET", body } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) {
        const msg = data?.error || data?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    }
    return {
      get:  (p)   => doFetch(p),
      post: (p,b) => doFetch(p, { method: "POST", body: b }),
      put:  (p,b) => doFetch(p, { method: "PUT", body: b }),
      del:  (p)   => doFetch(p, { method: "DELETE" }),
      patch:(p,b) => doFetch(p, { method: "PATCH", body: b }),
      base,
    };
  }, [baseURL]);
}

// ---------------- component ----------------
export default function Chatbox({ apiBase, user, onEventsUpdated }) {
  const api = useApi(apiBase);

  const [events, setEvents] = useState([]);
  const [input, setInput] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  function pushLog(who, text) {
    setLog((prev) => [...prev, { who, text }]);
  }

  useEffect(() => {
    if (!user?.id) return;
    refreshEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function refreshEvents() {
    try {
      const list = await api.get(`/events/${user.id}`);
      setEvents(list || []);
      onEventsUpdated?.(list || []);
    } catch (err) {
      pushLog("assistant", `⚠️ Failed to load events: ${err.message}`);
    }
  }

  // ---------- command handlers ----------
  async function cmdAdd(args) {
    const ixOn = args.indexOf("on");
    const ixFrom = args.indexOf("from");
    const ixTo = args.indexOf("to");
    if (ixOn === -1 || ixFrom === -1 || ixTo === -1 || ixTo <= ixFrom) {
      throw new Error(
        'Usage: add "Title" on <YYYY-MM-DD|today|tomorrow> from <HH:mm> to <HH:mm> [importance high|low] [urgency high|low] [difficulty easy|medium|hard] [allowDouble]'
      );
    }
    const title = args.slice(0, ixOn).join(" ").trim();
    if (!title) throw new Error("Missing title.");
    const dateWord = args[ixOn + 1];
    const date = parseDateKeyword(dateWord);
    if (!date) throw new Error("Invalid date.");
    const startStr = args[ixFrom + 1];
    const endStr = args[ixTo + 1];
    if (!/^\d{1,2}:\d{2}$/.test(startStr) || !/^\d{1,2}:\d{2}$/.test(endStr)) {
      throw new Error("Invalid time (use HH:mm 24h).");
    }

    let importance = "low";
    let urgency = "low";
    let difficulty = "medium";
    let allowDouble = false;

    for (let i = ixTo + 2; i < args.length; i++) {
      const k = args[i].toLowerCase();
      if (k === "importance" && args[i + 1]) importance = args[i + 1].toLowerCase().startsWith("h") ? "high" : "low";
      if (k === "urgency" && args[i + 1]) urgency = args[i + 1].toLowerCase().startsWith("h") ? "high" : "low";
      if (k === "difficulty" && args[i + 1]) {
        const d = args[i + 1].toLowerCase();
        if (["easy", "medium", "hard"].includes(d)) difficulty = d;
      }
      if (k === "allowdouble") allowDouble = true;
    }

    const startISO = toISO(date, startStr);
    const endISO = toISO(date, endStr);
    if (!startISO || !endISO) throw new Error("Could not compose timestamps.");

    const body = {
      title,
      start: startISO,
      end: endISO,
      importance,
      urgency,
      difficulty,
      userId: user.id, // your /events POST requires userId
      allowDouble,
    };
    const ev = await api.post("/events", body);
    pushLog("assistant", `✅ Added: ${ev.title} (${ev._id})`);
    await refreshEvents();
  }

  async function cmdEdit(args) {
    const ixSet = args.indexOf("set");
    if (ixSet === -1) throw new Error('Usage: edit <id|title> set key=value [...] (keys: title, importance, urgency, difficulty, start, end)');

    const target = args.slice(0, ixSet).join(" ");
    const eventId = resolveEventId(target, events);
    if (!eventId) throw new Error(`Event not found: ${target}`);

    const patch = {};
    for (let i = ixSet + 1; i < args.length; i++) {
      const part = args[i];
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const key = part.slice(0, eq);
      const val = part.slice(eq + 1);

      if (key === "title") patch.title = val;
      if (key === "importance") patch.importance = /high/i.test(val) ? "high" : "low";
      if (key === "urgency") patch.urgency = /high/i.test(val) ? "high" : "low";
      if (key === "difficulty" && /(easy|medium|hard)/i.test(val)) patch.difficulty = val.toLowerCase();

      if (key === "start" || key === "end") {
        const mm = val.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
        if (!mm) throw new Error(`Invalid ${key}. Use "YYYY-MM-DD HH:mm"`);
        const iso = toISO(mm[1], mm[2]);
        if (!iso) throw new Error(`Invalid ${key} datetime.`);
        patch[key] = iso;
      }
    }

    const ev = await api.put(`/events/${eventId}`, patch);
    pushLog("assistant", `✏️ Updated: ${ev.title} (${ev._id})`);
    await refreshEvents();
  }

  async function cmdDelete(args) {
    const target = args.join(" ");
    const eventId = resolveEventId(target, events);
    if (!eventId) throw new Error(`Event not found: ${target}`);
    await api.del(`/events/${eventId}`);
    pushLog("assistant", `🗑️ Deleted: ${target}`);
    await refreshEvents();
  }

  async function cmdShare(args) {
    const ixWith = args.indexOf("with");
    if (ixWith === -1) throw new Error("Usage: share <id|title> with <email>");
    const target = args.slice(0, ixWith).join(" ");
    const email = args[ixWith + 1];
    if (!/\S+@\S+\.\S+/.test(email || "")) throw new Error("Invalid email.");

    const eventId = resolveEventId(target, events);
    if (!eventId) throw new Error(`Event not found: ${target}`);

    const out = await api.post(`/events/${eventId}/share`, { recipientEmail: email });
    const title = events.find((e) => String(e._id) === eventId)?.title || target;
    pushLog("assistant", `📤 Shared "${title}" with ${email}`);
    if (out?.conflict) pushLog("assistant", "⚠️ Recipient has a conflicting event at that time.");
  }

  async function cmdSplit(args) {
    const lower = args.map((x) => x.toLowerCase());
    const ixByCount = lower.indexOf("bycount");
    const ixByDuration = lower.indexOf("byduration");
    const ixBreak = lower.indexOf("break");
    const ixPrefix = lower.indexOf("prefix");

    let targetTokens;
    if (ixByCount !== -1) targetTokens = args.slice(0, ixByCount);
    else if (ixByDuration !== -1) targetTokens = args.slice(0, ixByDuration);
    else throw new Error("Use: split <id|title> byCount N [break M] [prefix Text...] OR byDuration M [break N] [prefix Text...]");

    const target = targetTokens.join(" ");
    const eventId = resolveEventId(target, events);
    if (!eventId) throw new Error(`Event not found: ${target}`);

    const body = {};
    if (ixByCount !== -1) {
      const n = parseInt(args[ixByCount + 1], 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error("byCount needs a positive integer.");
      body.mode = "byCount";
      body.count = n;
    } else {
      const m = parseInt(args[ixByDuration + 1], 10);
      if (!Number.isFinite(m) || m <= 0) throw new Error("byDuration needs minutes (positive).");
      body.mode = "byDuration";
      body.segmentMinutes = m;
    }
    if (ixBreak !== -1) {
      const m = parseInt(args[ixBreak + 1], 10);
      if (Number.isFinite(m) && m >= 0) body.breakMinutes = m;
    }
    if (ixPrefix !== -1) {
      const p = args.slice(ixPrefix + 1).join(" ");
      if (p) body.titlePrefix = p;
    }

    const r = await api.post(`/events/${eventId}/split`, body);
    pushLog("assistant", `✂️ Created ${r?.segments?.length || 0} segment(s).`);
    await refreshEvents();
  }

  async function cmdMark(args) {
    const status = (args[args.length - 1] || "").toLowerCase();
    if (!["completed", "missed"].includes(status)) throw new Error("Usage: mark <id|title> completed|missed");
    const target = args.slice(0, -1).join(" ");
    const eventId = resolveEventId(target, events);
    if (!eventId) throw new Error(`Event not found: ${target}`);
    const out = await api.patch(`/events/${eventId}/status`, { status });
    pushLog("assistant", `✅ Marked as ${out?.status || status}.`);
    await refreshEvents();
  }

  async function cmdShow(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "today") {
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now);   end.setHours(23, 59, 59, 999);
      const todays = events.filter((e) => new Date(e.start) < end && new Date(e.end) > start);
      if (!todays.length) pushLog("assistant", "📭 No events today.");
      else {
        pushLog("assistant", "📅 Today:\n" +
          todays.map((e) => `• ${e.title} (${new Date(e.start).toLocaleString()} → ${new Date(e.end).toLocaleString()})`).join("\n")
        );
      }
      return;
    }
    if (!events.length) pushLog("assistant", "📭 No events.");
    else {
      pushLog("assistant", "🗂️ Events:\n" +
        events.map((e) => `• ${e.title} [${e._id}]  ${new Date(e.start).toLocaleString()} → ${new Date(e.end).toLocaleString()}`).join("\n")
      );
    }
  }

  async function run(raw) {
    if (!user?.id) {
      pushLog("assistant", "❌ I need a valid `user` prop (with `id`).");
      return;
    }
    const tokens = smartSplit(raw);
    if (!tokens.length) return;
    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    setBusy(true);
    try {
      if (cmd === "add") return await cmdAdd(args);
      if (cmd === "edit") return await cmdEdit(args);
      if (cmd === "delete" || cmd === "remove") return await cmdDelete(args);
      if (cmd === "share") return await cmdShare(args);
      if (cmd === "split") return await cmdSplit(args);
      if (cmd === "mark") return await cmdMark(args);
      if (cmd === "show" || cmd === "list") return await cmdShow(args);
      pushLog("assistant", "🤖 Unknown command. Try: add, edit, delete, share, split, mark, show");
    } catch (e) {
      // special case: conflict (409) often returned as message "Conflict detected"
      pushLog("assistant", `❌ ${e.message}`);
      if (/conflict/i.test(e.message)) {
        pushLog("assistant", "Tip: re-run with the word 'allowDouble' at the end to save despite the overlap.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    const text = input.trim();
    if (!text) return;
    pushLog("user", text);
    setInput("");
    await run(text);
  }

  // ---------------- UI ----------------
  return (
    <div className="flex h-[520px] flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900">Chat</div>
        <div className="text-xs text-gray-500">
          try:&nbsp;
          <code className="rounded bg-gray-100 px-1 py-0.5">
            add "Study" on today from 14:00 to 16:00 importance high difficulty easy
          </code>
        </div>
      </div>

      {/* user badge */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        {user?.id ? (
          <>signed in as <b>{user.fullname || user.email}</b></>
        ) : (
          <span className="text-red-600">No user provided to Chatbox — pass a user object with <code>id</code>.</span>
        )}
      </div>

      {/* log */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm leading-5"
      >
        {log.length === 0 && (
          <div className="text-gray-400">
            I can <b>add</b>, <b>edit</b>, <b>delete</b>, <b>share</b>, <b>split</b>, <b>mark</b>, and <b>show</b> your events.
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} className="mb-2 whitespace-pre-wrap">
            <b className={m.who === "user" ? "text-gray-900" : "text-emerald-700"}>
              {m.who === "user" ? "You" : "Astra"}
            </b>
            <span className="text-gray-700">: {m.text}</span>
          </div>
        ))}
      </div>

      {/* input */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-800 disabled:bg-gray-100"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder='add "Meeting" on 2025-10-10 from 09:00 to 10:00 urgency low'
          disabled={!user?.id || busy}
        />
        <button
          className={`rounded-xl px-4 py-2 text-sm font-medium text-white ${user?.id && !busy ? "bg-gray-900 hover:bg-black" : "bg-gray-400 cursor-not-allowed"}`}
          onClick={onSend}
          disabled={!user?.id || busy}
        >
          {busy ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
