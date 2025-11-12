// src/pages/Schedule.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import ShowModal from "../components/ShowModal";
import SegmentModal from "../components/SegmentModal";
import CreateConflictModal from "../components/CreateConflictModal";
import useReminders from "../util/useReminder";

import {
  FiSearch,
  FiFilter,
  FiClock,
  FiAlertTriangle,
  FiEdit2,
  FiTrash2,
  FiScissors,
  FiCheckCircle,
  FiXCircle,
} from "react-icons/fi";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_URL = "http://localhost:5000";
const TZ = "Asia/Manila";

// When parent progress >= this fraction, auto-mark parent "completed"
const THRESHOLD_COMPLETE = 0.6; // 60%

// Helpers
const baseId = (v = "") => {
  const s = String(v || "");
  return s.includes("-") ? s.split("-")[0] : s;
};

// TIME BLOCK classification
const getTimeBlock = (ev, selectedDate) => {
  const dayStart = dayjs(selectedDate).startOf("day");
  const dayEnd = dayjs(selectedDate).endOf("day");
  const evStart = dayjs(ev.start);
  const effective = evStart.isAfter(dayStart) ? evStart : dayStart;
  const effectiveSafe = effective.isAfter(dayEnd) ? dayStart : effective;
  const h = effectiveSafe.hour();
  if (h >= 0 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  if (h >= 17 && h < 21) return "Evening";
  return "Night";
};

const formatRange = (ev) =>
  `${dayjs(ev.start).format("MMM D, YYYY h:mm A")} – ${dayjs(ev.end).format("h:mm A")}`;

/* ===================== Priority helpers ===================== */
function priorityScore(ev) {
  const imp = ev.importance === "high" ? 3 : 1;
  const urg = ev.urgency === "high" ? 2 : 1;

  const now = dayjs().tz(TZ);
  const minutesFromNow = Math.max(0, dayjs(ev.start).tz(TZ).diff(now, "minute"));
  const proximityBoost = 1 / (1 + minutesFromNow / 60); // 0..1

  // Easier tasks get a slight bonus so you can knock them out quickly.
  const diffMap = { easy: 0.5, medium: 0.25, hard: 0 };
  const diffBonus = diffMap[String(ev.difficulty || "medium")] ?? 0.25;

  return imp * 2 + urg * 1.5 + proximityBoost + diffBonus;
}

function scoreColor(score = 0) {
  if (score >= 6) return "bg-red-600";
  if (score >= 5) return "bg-orange-600";
  if (score >= 4) return "bg-amber-600";
  if (score >= 3) return "bg-blue-600";
  return "bg-slate-500";
}
/* ============================================================ */

/* ===================== Tiny Toasts (no external deps) ===================== */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    const t = { id, type: toast.type || "info", message: toast.message || "" };
    setToasts((prev) => [...prev, t]);
    // auto-hide after 3s
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3000);
  }, []);
  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  return { toasts, push, remove };
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => {
        const colors =
          t.type === "success"
            ? "bg-emerald-600"
            : t.type === "error"
            ? "bg-rose-600"
            : t.type === "warning"
            ? "bg-amber-600"
            : "bg-slate-700";
        return (
          <div
            key={t.id}
            className={`${colors} text-white shadow-lg rounded-lg px-4 py-3 flex items-start gap-3 max-w-xs`}
          >
            <div className="text-sm leading-snug">{t.message}</div>
            <button
              onClick={() => onClose(t.id)}
              className="text-white/80 hover:text-white text-xs ml-auto"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
/* ======================================================================== */

export default function Schedule() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [events, setEvents] = useState([]);

  // 🔁 Live clock for time-based UI (updates every 30s)
  const [now, setNow] = useState(dayjs());
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Only owned vs owned double-booking (exact-match)
  const [doubleBookedIds, setDoubleBookedIds] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [formError, setFormError] = useState("");
  const [startTimePastError, setStartTimePastError] = useState("");

  // Create-time conflict modal (when POST /events returns 409)
  const [createConflict, setCreateConflict] = useState({
    open: false,
    conflicts: [],
    newEvent: null,
  });

  const [segmentOpen, setSegmentOpen] = useState(false);
  const [segmentTarget, setSegmentTarget] = useState(null);

  // UI filters/search
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all"); // all | overlaps
  const [urgencyFilter, setUrgencyFilter] = useState("all"); // all | high | low
  const [importanceFilter, setImportanceFilter] = useState("all"); // all | high | low

  const [form, setForm] = useState({
    title: "",
    start: "",
    end: "",
    importance: "low",
    urgency: "low",
    difficulty: "medium",
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const { scheduleReminders, cancelRemindersFor, ensurePermission } = useReminders();
  const scheduledThisRenderRef = useRef({}); // keep
  const autoCompletedRef = useRef(new Set());

  // ✅ Toasts
  const { toasts, push, remove } = useToasts();

  // ✅ Ask for notification permission on mount (kept)
  useEffect(() => {
    ensurePermission?.();
  }, [ensurePermission]);

  const hasValidDuration = (ev) => {
    const s = dayjs(ev?.start);
    const e = dayjs(ev?.end);
    return s.isValid() && e.isValid() && e.isAfter(s);
  };

  // Show ALL events that overlap the selected day
  const dayStart = dayjs(selectedDate).startOf("day");
  const dayEnd = dayjs(selectedDate).endOf("day");

  const filteredUpcomingEvents = useMemo(
    () =>
      events
        .filter((ev) => ev)
        .filter((ev) => dayjs(ev.start).isBefore(dayEnd) && dayjs(ev.end).isAfter(dayStart))
        .filter((ev) => !["completed", "missed"].includes(ev.status))
        .sort((a, b) => {
          // primary: start time
          const byStart = new Date(a.start) - new Date(b.start);
          if (byStart !== 0) return byStart;

          // secondary: parents before children when same start
          const aIsChild = !!a.segmentOf;
          const bIsChild = !!b.segmentOf;
          if (aIsChild !== bIsChild) return aIsChild ? 1 : -1;

          // tertiary: if both children of same parent, order by segmentIndex
          if (
            a.segmentOf &&
            b.segmentOf &&
            String(a.segmentOf).split("-")[0] === String(b.segmentOf).split("-")[0]
          ) {
            const ai =
              typeof a.segmentIndex === "number" ? a.segmentIndex : Number.MAX_SAFE_INTEGER;
            const bi =
              typeof b.segmentIndex === "number" ? b.segmentIndex : Number.MAX_SAFE_INTEGER;
            return ai - bi;
          }

          // final fallback: end time
          return new Date(a.end) - new Date(b.end);
        }),
    [events, dayStart, dayEnd]
  );

  /* ----------------- Build children map EARLY (used by ordering) ----------------- */
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      if (e?.segmentOf) {
        const pid = baseId(String(e.segmentOf));
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid).push(e);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.start) - new Date(b.start));
    }
    return map;
  }, [events]);

  const parentIdsWithChildren = useMemo(
    () => new Set(Array.from(childrenByParent.keys())),
    [childrenByParent]
  );

  /* ========== Compute priority score & unique priority order numbering ========== */
  const scoreMap = new Map();
  const orderMap = new Map(); // unique sequential order (1,2,3,...)

  // Give an order number to every standalone event AND every child event.
  // Parents that have children are excluded from the ordering.
  const orderingPool = filteredUpcomingEvents
    .filter((ev) => {
      const evBase = baseId(String(ev._id));
      if (!ev.segmentOf && parentIdsWithChildren.has(evBase)) return false; // exclude parent from numbering
      return true; // include standalone or child
    })
    .map((ev) => ({
      ev,
      score: priorityScore(ev),
      startMs: +new Date(ev.start),
    }));

  // Sort strictly by score desc, then start asc to break ties
  orderingPool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.startMs - b.startMs;
  });

  // Assign unique sequential priority order numbers
  orderingPool.forEach((item, idx) => {
    const id = baseId(item.ev._id);
    scoreMap.set(id, item.score);
    orderMap.set(id, idx + 1); // 1-based unique numbering
  });
  /* ============================================================================ */

  // ================== FETCH OWNED EVENTS ==================
  const fetchEvents = useCallback(async (userId) => {
    const res = await fetch(`${API_URL}/events/${userId}`);
    const data = await res.json();
    return data;
  }, []);

  const refreshAll = useCallback(async () => {
    if (!user?.id) return;
    try {
      const owned = await fetchEvents(user.id);
      setEvents(owned);
    } catch (err) {
      console.error("Failed to refresh events:", err);
      push({ type: "error", message: "Failed to refresh events." });
    }
  }, [user?.id, fetchEvents, push]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ================== EXACT-MATCH DOUBLE-BOOK DETECTION ==================
  useEffect(() => {
    if (!user?.id || !events.length) {
      setDoubleBookedIds([]);
      return;
    }

    const sameFamily = (x, y) => {
      if (!x || !y) return false;
      const xid = baseId(String(x._id || ""));
      const yid = baseId(String(y._id || ""));
      const xParent = x.segmentOf ? baseId(String(x.segmentOf)) : null;
      const yParent = y.segmentOf ? baseId(String(y.segmentOf)) : null;

      return (
        xid === yid ||
        (xParent && xParent === yid) ||
        (yParent && yParent === xid) ||
        (xParent && yParent && xParent === yParent)
      );
    };

    const owned = events
      .filter((e) => String(e.userId) === String(user.id) && !e?.isVirtual && !e?.status)
      .map((e) => ({
        id: baseId(e._id),
        _id: String(e._id),
        start: new Date(e.start).getTime(),
        end: new Date(e.end).getTime(),
        ref: e,
      }))
      .sort((a, b) => a.start - b.start);

    const flags = new Set();
    for (let i = 0; i < owned.length; i++) {
      for (let j = i + 1; j < owned.length; j++) {
        const A = owned[i];
        const B = owned[j];
        if (B.start > A.end) break;
        if (sameFamily(A.ref, B.ref)) continue;

        // ✅ Only flag when BOTH start and end are EXACTLY the same
        if (A.start === B.start && A.end === B.end) {
          flags.add(A.id);
          flags.add(B.id);
        }
      }
    }
    setDoubleBookedIds(Array.from(flags));
  }, [events, user?.id]);

  const isDoubleBooked = (event) => doubleBookedIds.includes(baseId(event._id));

  // ================== VALIDATION ==================
  useEffect(() => {
    if (!form.start) {
      setStartTimePastError("");
      return;
    }
    const phNow = dayjs().tz(TZ);
    const startTime = dayjs(form.start).tz(TZ);
    const endTime = form.end ? dayjs(form.end).tz(TZ) : null;

    if (editingEvent) {
      const originalStart = dayjs(editingEvent.start).tz(TZ);
      setStartTimePastError(
        startTime.isBefore(originalStart)
          ? `❌ Start time cannot be earlier than the original (${originalStart.format(
              "MMM D, YYYY h:mm A"
            )})`
          : ""
      );
    } else {
      setStartTimePastError(
        startTime.isBefore(phNow) ? "❌ Start time cannot be in the past PH time!" : ""
      );
    }

    if (endTime && startTime.isAfter(endTime)) {
      setFormError("❌ Start time must be earlier than End time!");
    } else setFormError("");
  }, [form.start, form.end, editingEvent]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  // ================== ADD OR UPDATE ==================
  const handleSubmit = async (e) => {
    e.preventDefault();
    const phNow = dayjs().tz(TZ);
    const startTime = dayjs(form.start).tz(TZ);
    const endTime = dayjs(form.end).tz(TZ);

    if (editingEvent && startTime.isBefore(dayjs(editingEvent.start).tz(TZ))) {
      setStartTimePastError(
        `❌ Start time cannot be earlier than original (${dayjs(editingEvent.start)
          .tz(TZ)
          .format("MMM D, YYYY h:mm A")})`
      );
      return;
    }
    if (!editingEvent && startTime.isBefore(phNow)) {
      setStartTimePastError("❌ Start time cannot be in the past PH time!");
      return;
    }
    if (endTime.isBefore(startTime)) {
      setFormError("❌ End time must be after start time!");
      return;
    }

    const payload = {
      ...form,
      start: new Date(form.start),
      end: new Date(form.end),
      userId: user.id,
    };

    try {
      if (editingEvent) {
        const res = await fetch(`${API_URL}/events/${baseId(editingEvent._id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const updated = await res.json();
        if (!res.ok) throw new Error(updated?.error || "Failed to update event");
        setEvents((prev) =>
          prev.map((ev) => (baseId(ev._id) === baseId(updated._id) ? updated : ev))
        );
        cancelRemindersFor(baseId(updated._id));
        push({ type: "success", message: "Event updated." });
        closeModal();
        return;
      }

      // Create
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        // Server-side exact duplicate → open CreateConflictModal WITH newEvent object
        const data = await res.json().catch(() => ({}));
        setCreateConflict({
          open: true,
          conflicts: data?.conflict ? [data.conflict] : [],
          newEvent: payload, // <-- pass full payload so modal can compute suggestions
        });
        push({ type: "warning", message: "Exact duplicate detected. Choose an action." });
        return;
      }

      const newEvent = await res.json();
      if (!res.ok) throw new Error(newEvent?.error || "Failed to create event");

      setEvents((prev) => [...prev, newEvent]);
      push({ type: "success", message: "Event created." });
      closeModal();
    } catch (err) {
      console.error(err);
      push({ type: "error", message: err.message || "Failed to save event." });
      alert(err.message || "Failed to save event");
    }
  };

  // ================== DELETE ==================
  const handleDelete = async (id) => {
    try {
      const cleanId = baseId(id);
      const res = await fetch(`${API_URL}/events/${cleanId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to delete event");
      }
      setEvents((prev) => prev.filter((ev) => baseId(ev._id) !== cleanId));
      cancelRemindersFor(cleanId);
      push({ type: "success", message: "Event deleted." });
    } catch (err) {
      console.error(err);
      push({ type: "error", message: err.message || "Failed to delete event." });
    }
  };

  // ================== STATUS ==================
  const markStatus = useCallback(
    async (id, status) => {
      try {
        const cleanId = baseId(id);
        const res = await fetch(`${API_URL}/events/${cleanId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to update status");

        setEvents((prev) => {
          let next = prev.map((ev) =>
            baseId(ev._id) === cleanId ? { ...ev, status: result.status } : ev
          );

          // If parent got finalized by the server, reflect it so UI hides it
          if (result.parentUpdated && result.parent) {
            const pid = baseId(result.parent._id);
            next = next.map((ev) =>
              baseId(ev._id) === pid ? { ...ev, status: result.parent.status } : ev
            );
          }

        // toast based on action
          push({
            type: status === "completed" ? "success" : "warning",
            message:
              status === "completed" ? "Marked as completed." : "Marked as missed.",
          });

          return next;
        });

        cancelRemindersFor(cleanId);
      } catch (err) {
        console.error("Failed to update status", err);
        push({ type: "error", message: err.message || "Failed to update status." });
        alert(err.message || "Failed to update status");
      }
    },
    [cancelRemindersFor, push]
  );

  // ================== MODALS ==================
  const openModal = (event = null) => {
    if (event) {
      setEditingEvent(event);
      setForm({
        title: event.title,
        start: dayjs(event.start).format("YYYY-MM-DDTHH:mm"),
        end: dayjs(event.end).format("YYYY-MM-DDTHH:mm"),
        importance: event.importance,
        urgency: event.urgency,
        difficulty: event.difficulty || "medium",
      });
    } else {
      setEditingEvent(null);
      setForm({
        title: "",
        start: selectedDate.format("YYYY-MM-DDTHH:mm"),
        end: selectedDate.format("YYYY-MM-DDTHH:mm"),
        importance: "low",
        urgency: "low",
        difficulty: "medium",
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm({
      title: "",
      start: "",
      end: "",
      importance: "low",
      urgency: "low",
      difficulty: "medium",
    });
    setFormError("");
    setStartTimePastError("");
    setEditingEvent(null);
  };

  // ----------------- Segment relations & progress -----------------
  const parentProgress = useMemo(() => {
    const out = new Map();
    for (const [pid, arr] of childrenByParent.entries()) {
      const k = arr.length || 1;
      const done = arr.filter((c) => c.status === "completed").length;
      out.set(pid, done / k);
    }
    return out;
  }, [childrenByParent]);

  // Auto-mark parent completed (UX helper) when threshold hit
  useEffect(() => {
    if (!events.length) return;
    for (const pid of parentIdsWithChildren) {
      if (autoCompletedRef.current.has(pid)) continue;
      const progress = parentProgress.get(pid) ?? 0;
      if (progress >= THRESHOLD_COMPLETE) {
        const parent = events.find((e) => baseId(String(e._id)) === pid && !e.segmentOf);
        if (parent && !parent.status) {
          autoCompletedRef.current.add(pid);
          markStatus(pid, "completed");
        }
      }
    }
  }, [parentIdsWithChildren, parentProgress, events, markStatus]);

  // ✅ Schedule reminders for *eligible* events and avoid duplicates this render
  useEffect(() => {
    if (!scheduleReminders) return;
    if (!filteredUpcomingEvents.length) return;

    filteredUpcomingEvents.forEach((evt) => {
      const id = baseId(String(evt._id));
      // skip parents that have children; skip finalized items
      if (parentIdsWithChildren.has(id)) return;
      if (evt.status) return;

      if (!scheduledThisRenderRef.current[id]) {
        scheduleReminders(evt);
        scheduledThisRenderRef.current[id] = true;
      }
    });
    // no cleanup needed; reminders are one-shot per event id
  }, [filteredUpcomingEvents, parentIdsWithChildren, scheduleReminders]);

  // ================== SEGMENTING ==================
  const canonicalizeEvent = useCallback(
    (ev) => {
      if (!ev) return null;
      const id = baseId(String(ev._id || ""));
      return events.find((x) => String(x._id) === id) || ev;
    },
    [events]
  );

  const openSegment = (ev) => {
    const real = canonicalizeEvent(ev);
    if (!real || real.isVirtual || !hasValidDuration(real)) {
      alert("This event can't be segmented: invalid/virtual/zero duration.");
      return;
    }
    setSegmentTarget(real);
    setSegmentOpen(true);
  };

  const closeSegment = () => {
    setSegmentOpen(false);
    setSegmentTarget(null);
  };

  const handleSplitSuccess = (insertedSegments = []) => {
    setEvents((prev) => {
      const parentId = baseId(segmentTarget._id);
      const keepParent = prev.find((e) => baseId(e._id) === parentId);
      const others = prev.filter((e) => baseId(e._id) !== parentId);
      return keepParent ? [...others, keepParent, ...insertedSegments] : [...prev, ...insertedSegments];
    });
    push({ type: "success", message: "Segments created." });
    closeSegment();
  };

  const canSegmentEvent = (ev) => {
    if (!ev) return false;
    if (ev.segmentOf) return false;
    if (parentIdsWithChildren.has(baseId(String(ev._id)))) return false;
    if (!hasValidDuration(ev)) return false;
    if (dayjs(ev.end).diff(dayjs(ev.start), "minute") < 180) return false;
    return true;
  };

  // ------- Derived: Today counters & filtered view -------
  const groupByOwner = useMemo(() => {
    const map = new Map();
    for (const ev of filteredUpcomingEvents) {
      const owner = ev.segmentOf ? baseId(String(ev.segmentOf)) : baseId(String(ev._id));
      if (!map.has(owner)) map.set(owner, []);
      map.get(owner).push(ev);
    }
    return map;
  }, [filteredUpcomingEvents]);

  const ownerList = useMemo(() => {
    const out = [];
    for (const [ownerId, arr] of groupByOwner.entries()) {
      const children = arr.filter((x) => x.segmentOf && baseId(String(x.segmentOf)) === ownerId);
      const parent = arr.find((x) => !x.segmentOf && baseId(String(x._id)) === ownerId);
      const representative = parent || arr[0];
      out.push({
        ownerId,
        parent,
        children,
        representative,
        isParent: children.length > 0,
      });
    }
    return out;
  }, [groupByOwner]);

  const todayCount = ownerList.length;

  const overlapsCount = ownerList.filter((g) => {
    return g.representative && isDoubleBooked(g.representative);
  }).length;

  // Build filtered "visible" list for rendering (render individual events)
  let visible = [...filteredUpcomingEvents];

  if (query.trim()) {
    const q = query.toLowerCase();
    visible = visible.filter((e) => String(e.title || "").toLowerCase().includes(q));
  }

  if (view === "overlaps") {
    visible = visible.filter((e) => isDoubleBooked(e));
  }

  if (urgencyFilter !== "all") {
    visible = visible.filter((e) => e.urgency === urgencyFilter);
  }
  if (importanceFilter !== "all") {
    visible = visible.filter((e) => e.importance === importanceFilter);
  }

  const grouped = visible.reduce((acc, ev) => {
    const blk = getTimeBlock(ev, selectedDate);
    (acc[blk] = acc[blk] || []).push(ev);
    return acc;
  }, {});

  // ----- Create-Conflict handlers (client-side) -----
  const handleCreateReplace = async () => {
    try {
      const c = createConflict.conflicts?.[0];
      const candidate = createConflict.newEvent;
      if (!c || !candidate)
        return setCreateConflict({ open: false, conflicts: [], newEvent: null });

      await fetch(`${API_URL}/events/${baseId(c._id)}`, { method: "DELETE" });

      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create event");

      setCreateConflict({ open: false, conflicts: [], newEvent: null });
      setEvents((prev) => [...prev, data]);
      push({ type: "success", message: "Replaced with new event." });
      refreshAll();
    } catch (err) {
      push({ type: "error", message: err.message || "Failed to replace." });
      alert(err.message || "Failed to replace");
    }
  };

  const handleCreateKeep = async () => {
    try {
      const candidate = createConflict.newEvent;
      if (!candidate) {
        setCreateConflict({ open: false, conflicts: [], newEvent: null });
        return;
      }

      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...candidate, allowDouble: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create event");

      setCreateConflict({ open: false, conflicts: [], newEvent: null });
      setEvents((prev) => [...prev, data]);
      push({ type: "success", message: "Kept both events." });
      await refreshAll();
    } catch (err) {
      push({ type: "error", message: err.message || "Failed to keep both." });
      alert(err.message || "Failed to keep both");
    }
  };

  const handleCreateReschedule = (slot) => {
    if (!slot?.start || !slot?.end) return;
    setCreateConflict({ open: false, conflicts: [], newEvent: null });
    setEditingEvent(null);
    setForm((prev) => ({
      ...prev,
      start: dayjs(slot.start).format("YYYY-MM-DDTHH:mm"),
      end: dayjs(slot.end).format("YYYY-MM-DDTHH:mm"),
    }));
    setShowModal(true);
    push({ type: "info", message: "Suggestion applied. Adjust if needed." });
  };

  const ProgressBar = ({ fraction }) => {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    return (
      <div className="mt-2">
        <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-2 bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-slate-600 mt-1">{pct}% complete</div>
      </div>
    );
  };

  const SegmentChips = ({ childrenList = [] }) => {
    if (!childrenList.length) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {childrenList.map((c, i) => {
          const st = c.status || "pending";
          const color =
            st === "completed"
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : st === "missed"
              ? "bg-rose-100 text-rose-700 border-rose-200"
              : "bg-slate-100 text-slate-700 border-slate-200";
          return (
            <span key={c._id || i} className={`text-[11px] px-2 py-0.5 rounded-full border ${color}`}>
              Seg {typeof c.segmentIndex === "number" ? c.segmentIndex + 1 : i + 1} · {st}
            </span>
          );
        })}
      </div>
    );
  };

  // ================== RENDER ==================
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
      <Navbar />
      <main className="flex-grow p-4 sm:p-6">
        <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left: Calendar + Stats */}
          <div className="md:col-span-5 lg:col-span-4">
            <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-xl text-green-900">Calendar</h2>
                <span className="text-xs text-gray-500">
                  PH time · {now.tz(TZ).format("MMM D, YYYY h:mm A")}
                </span>
              </div>

              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateCalendar
                  value={selectedDate}
                  onChange={setSelectedDate}
                  shouldDisableDate={(d) => dayjs(d).isBefore(dayjs(), "day")}
                />
              </LocalizationProvider>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="rounded-xl border border-green-100 bg-green-50 p-3 text-center">
                  <div className="text-xs text-gray-500">Today</div>
                  <div className="text-xl font-bold text-green-700">{todayCount}</div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
                  <div className="text-xs text-gray-500">Overlaps</div>
                  <div className="text-xl font-bold text-amber-700">{overlapsCount}</div>
                </div>
              </div>

              <button
                onClick={() => openModal()}
                disabled={dayjs(selectedDate).isBefore(dayjs(), "day")}
                className={`mt-4 w-full py-2 rounded-xl font-semibold text-white transition-colors duration-200 ${
                  dayjs(selectedDate).isBefore(dayjs(), "day")
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-green-700 hover:bg-green-800"
                }`}
              >
                + Add Event
              </button>

              {/* Legend */}
              <div className="mt-4 text-xs text-gray-500 flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Urgent
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Important
                </span>
                <span className="inline-flex items-center gap-1">
                  <FiAlertTriangle className="text-amber-600" /> Overlap
                </span>
                <span className="inline-flex items-center gap-1">
                  <FiClock /> Ongoing
                </span>
              </div>
            </div>
          </div>

          {/* Right: Filters + Grouped List */}
          <div className="md:col-span-7 lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6">
              {/* Sticky header */}
              <div className="sticky top-0 bg-white/80 backdrop-blur z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-b">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h1 className="font-bold text-2xl text-green-900">
                      {selectedDate.format("dddd, MMM D")}
                    </h1>
                    <p className="text-sm text-gray-500">Your schedule for the day</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {/* Search */}
                    <div className="relative">
                      <FiSearch className="absolute left-3 top-2.5 text-gray-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search title…"
                        className="pl-9 pr-3 py-2 rounded-lg border focus:ring-2 focus:ring-green-600 outline-none text-sm"
                      />
                    </div>

                    {/* View Filter */}
                    <div className="flex items-center gap-1 bg-gray-50 border rounded-lg p-1">
                      {["all", "overlaps"].map((v) => (
                        <button
                          key={v}
                          onClick={() => setView(v)}
                          className={`px-3 py-1.5 rounded-md text-sm ${
                            view === v ? "bg-green-600 text-white" : "text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          {v[0].toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>

                    {/* Importance/Urgency */}
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:inline text-xs text-gray-500">
                        <FiFilter className="inline mr-1" />
                        Filters:
                      </span>
                      <select
                        value={urgencyFilter}
                        onChange={(e) => setUrgencyFilter(e.target.value)}
                        className="text-sm border rounded-md px-2 py-1.5"
                        title="Urgency"
                      >
                        <option value="all">Urgency: All</option>
                        <option value="high">Urgent</option>
                        <option value="low">Somewhat Urgent</option>
                      </select>
                      <select
                        value={importanceFilter}
                        onChange={(e) => setImportanceFilter(e.target.value)}
                        className="text-sm border rounded-md px-2 py-1.5"
                        title="Importance"
                      >
                        <option value="all">Importance: All</option>
                        <option value="high">Important</option>
                        <option value="low">Somewhat Important</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Grouped list */}
              {visible.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-lg">No events match your filters.</p>
                  <p className="text-sm">Try adjusting filters or add a new event.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-8">
                  {["Morning", "Afternoon", "Evening", "Night"]
                    .filter((b) => (grouped[b] || []).length > 0)
                    .map((block) => (
                      <section key={block}>
                        <h3 className="text-gray-700 font-semibold text-sm mb-3 uppercase tracking-wide">
                          {block}
                        </h3>
                        <ul className="space-y-3">
                          {(grouped[block] || []).map((event) => {
                            const isOngoing =
                              now.tz(TZ).isAfter(dayjs(event.start).tz(TZ)) &&
                              now.tz(TZ).isBefore(dayjs(event.end).tz(TZ));

                            const eid = baseId(event._id);
                            const order = orderMap.get(eid); // unique sequence number
                            const sc = scoreMap.get(eid) ?? priorityScore(event);
                            const showOrder = typeof order === "number";

                            const isParent = parentIdsWithChildren.has(eid);
                            const kids = isParent ? childrenByParent.get(eid) || [] : [];
                            const progress = isParent ? parentProgress.get(eid) ?? 0 : 0;
                            const k = kids.length;

                            return (
                              <li
                                key={event._id}
                                className={[
                                  "p-4 rounded-xl shadow-sm border",
                                  "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3",
                                  "transition hover:shadow-md",
                                  isDoubleBooked(event)
                                    ? "border-amber-300 bg-amber-50/40"
                                    : "border-gray-100 bg-white",
                                  event.status === "completed" ? "bg-green-50 border-green-200" : "",
                                  event.status === "missed" ? "bg-red-50 border-red-200" : "",
                                ].join(" ")}
                              >
                                <div className="flex-1 w-full">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {showOrder && (
                                      <span
                                        className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-semibold ${scoreColor(
                                          sc
                                        )}`}
                                        title={`Priority order #${order}`}
                                      >
                                        {order}
                                      </span>
                                    )}

                                    <p className="font-semibold text-lg text-gray-800">
                                      {event.title}
                                    </p>

                                    {showOrder && (
                                      <span
                                        className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                                        title="Priority score"
                                      >
                                        score {Number(sc).toFixed(1)}
                                      </span>
                                    )}

                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full border ${
                                        event.urgency === "high"
                                          ? "border-red-200 text-red-600 bg-red-50"
                                          : "border-orange-200 text-orange-600 bg-orange-50"
                                      }`}
                                    >
                                      {event.urgency === "high" ? "Urgent" : "Somewhat Urgent"}
                                    </span>
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full border ${
                                        event.importance === "high"
                                          ? "border-blue-200 text-blue-700 bg-blue-50"
                                          : "border-gray-200 text-gray-600 bg-gray-50"
                                      }`}
                                    >
                                      {event.importance === "high"
                                        ? "Important"
                                        : "Somewhat Important"}
                                    </span>

                                    {isOngoing && (
                                      <span className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                        <FiClock /> Ongoing
                                      </span>
                                    )}

                                    {isDoubleBooked(event) && (
                                      <span className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                        <FiAlertTriangle /> Possible overlap
                                      </span>
                                    )}

                                    {isParent && (
                                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Segmented · {k} parts
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-gray-600 text-sm mt-1">
                                    {formatRange(event)}
                                  </p>

                                  {/* Segment progress for parent */}
                                  {isParent && (
                                    <>
                                      <ProgressBar fraction={progress} />
                                      <div className="text-xs text-slate-600 mt-1">
                                        {Math.round(progress * k)} of {k} segments completed
                                        {progress >= THRESHOLD_COMPLETE && !event.status && (
                                          <span className="ml-2 text-emerald-700 font-medium">
                                            (auto-marked complete at{" "}
                                            {Math.round(THRESHOLD_COMPLETE * 100)}%)
                                          </span>
                                        )}
                                      </div>
                                      <SegmentChips childrenList={kids} />
                                    </>
                                  )}

                                  {/* Manual mark only when past end and not already marked */}
                                  {now.tz(TZ).isAfter(dayjs(event.end).tz(TZ)) &&
                                    !event.status &&
                                    !isParent && (
                                      <div className="flex gap-2 mt-3">
                                        <button
                                          onClick={() => markStatus(event._id, "completed")}
                                          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                                        >
                                          <FiCheckCircle /> Mark Completed
                                        </button>
                                        <button
                                          onClick={() => markStatus(event._id, "missed")}
                                          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                                        >
                                          <FiXCircle /> Mark Missed
                                        </button>
                                      </div>
                                    )}
                                </div>

                                <div className="flex gap-2 flex-shrink-0">
                                  {!event.status && (
                                    <button
                                      onClick={() => openModal(event)}
                                      title="Edit"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-yellow-400 text-white hover:bg-yellow-500"
                                    >
                                      <FiEdit2 />
                                      <span className="hidden sm:inline">Edit</span>
                                    </button>
                                  )}
                                  {!event.status && (
                                    <button
                                      onClick={() => handleDelete(event._id)}
                                      title="Delete"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600"
                                    >
                                      <FiTrash2 />
                                      <span className="hidden sm:inline">Delete</span>
                                    </button>
                                  )}

                                  {/* Split button: show ONLY when canSegmentEvent returns true */}
                                  {!event.status && canSegmentEvent(event) && (
                                    <button
                                      onClick={() => openSegment(event)}
                                      title="Split into segments"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-purple-600 text-white hover:bg-purple-700"
                                    >
                                      <FiScissors />
                                      <span className="hidden sm:inline">Split</span>
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      <ShowModal
        show={showModal}
        closeModal={closeModal}
        handleSubmit={handleSubmit}
        handleChange={handleChange}
        form={form}
        editingEvent={editingEvent}
        formError={formError}
        startTimePastError={startTimePastError}
      />

      <SegmentModal
        isOpen={segmentOpen}
        onClose={closeSegment}
        event={segmentTarget}
        onSplitSuccess={handleSplitSuccess}
      />

      <CreateConflictModal
        isOpen={createConflict.open}
        onClose={() => setCreateConflict({ open: false, conflicts: [], newEvent: null })}
        conflicts={createConflict.conflicts}
        suggestions={[]}
        onReplace={handleCreateReplace}
        onKeep={handleCreateKeep}
        onReschedule={handleCreateReschedule}
        newEvent={createConflict.newEvent} // <-- pass full new event payload (important)
      />

      {/* Toasts */}
      <ToastStack toasts={toasts} onClose={remove} />
    </div>
  );
}
