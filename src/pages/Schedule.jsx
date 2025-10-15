// src/pages/Schedule.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import ShowModal from "../components/ShowModal";
import ConflictModal from "../components/ConflictModal";
import ShareModal from "../components/ShareModal";
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
  FiShare2,
  FiCheckCircle,
  FiXCircle,
} from "react-icons/fi";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_URL = "http://localhost:5000";
const TZ = "Asia/Manila";

// Strip virtual suffix like "68c...-2025"
const baseId = (v = "") => {
  const s = String(v || "");
  return s.includes("-") ? s.split("-")[0] : s;
};

// Time-of-day grouping
const getTimeBlock = (d) => {
  const h = dayjs(d).hour();
  if (h >= 5 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  if (h >= 17 && h < 21) return "Evening";
  return "Night";
};

const formatRange = (ev) =>
  `${dayjs(ev.start).format("MMM D, YYYY h:mm A")} – ${dayjs(ev.end).format("h:mm A")}`;

/* ===================== ADDED: Priority helpers ===================== */
// Simple priority score: higher = more priority.
// We weigh Importance more than Urgency, and give a small boost to nearer start times.
// Completed/missed and already-ended are filtered OUT elsewhere and won’t get ranked.
function priorityScore(ev) {
  const imp = ev.importance === "high" ? 3 : 1;
  const urg = ev.urgency === "high" ? 2 : 1;

  // Nearer start gets a tiny boost, but not dominant
  const now = dayjs().tz(TZ);
  const minutesFromNow = Math.max(0, dayjs(ev.start).diff(now, "minute"));
  const proximityBoost = 1 / (1 + minutesFromNow / 60); // 0..1

  // Difficulty nudges: easier slightly higher priority to start sooner
  const diffMap = { easy: 0.5, medium: 0.25, hard: 0 };
  const diffBonus = diffMap[String(ev.difficulty || "medium")] ?? 0.25;

  return imp * 2 + urg * 1.5 + proximityBoost + diffBonus;
}

// Color for the circular rank bubble based on score (just a visual cue)
function scoreColor(score = 0) {
  if (score >= 6) return "bg-red-600";       // top priority
  if (score >= 5) return "bg-orange-600";    // high
  if (score >= 4) return "bg-amber-600";     // medium-high
  if (score >= 3) return "bg-blue-600";      // medium
  return "bg-slate-500";                     // low/else
}
/* =================================================================== */

export default function Schedule() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [events, setEvents] = useState([]);
  const [doubleBookedIds, setDoubleBookedIds] = useState([]); // baseIds that are overlapping (owned vs owned)
  const [overlapsWithOwnedIds, setOverlapsWithOwnedIds] = useState([]); // baseIds that overlap ANY event with my owned events
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [formError, setFormError] = useState("");
  const [startTimePastError, setStartTimePastError] = useState("");
  const [conflictEvent, setConflictEvent] = useState(null);

  // Create-time conflict modal (when POST /events returns 409)
  const [createConflict, setCreateConflict] = useState({
    open: false,
    conflicts: [],
    newEvent: null,
  });

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [eventToShare, setEventToShare] = useState(null);

  const [segmentOpen, setSegmentOpen] = useState(false);
  const [segmentTarget, setSegmentTarget] = useState(null);

  // UI filters/search
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all"); // all | mine | pending | overlaps
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
  const scheduledThisRenderRef = useRef({});

  const senderEmail = user?.email || "";

  // Ask for Web Notification permission once
  useEffect(() => {
    ensurePermission?.();
  }, [ensurePermission]);

  const hasValidDuration = (ev) => {
    const s = dayjs(ev?.start);
    const e = dayjs(ev?.end);
    return s.isValid() && e.isValid() && e.isAfter(s);
  };

  // Strip virtual suffix and return the real event object if we have it in state
  const canonicalizeEvent = useCallback(
    (ev) => {
      if (!ev) return null;
      const id = baseId(String(ev._id || "")); // e.g. "abc123-2025" -> "abc123"
      return events.find((x) => String(x._id) === id) || ev;
    },
    [events]
  );

  // Birthday recurrence (virtual projection for selected year) — safe guard
  const expandBirthday = (event, atDate) => {
    if (!event || !event.title) return [];
    if (!String(event.title).includes("Birthday 🎂")) return [event];
    const selectedYear = dayjs(atDate).year();
    const birthdayBase = dayjs(event.start);
    const birthdayThisYear = birthdayBase.year(selectedYear);
    return [
      {
        ...event,
        _id: `${event._id}-${selectedYear}`,
        start: birthdayThisYear.toDate(),
        end: birthdayThisYear.endOf("day").toDate(),
        isVirtual: true,
      },
    ];
  };

  // ===== Segmentation helpers =====
  const parentIdsWithChildren = new Set(
    events.filter((e) => e && e.segmentOf).map((e) => String(e.segmentOf))
  );

  // Show ALL events (parents remain visible even when segmented)
  const dayStart = dayjs(selectedDate).startOf("day");
  const dayEnd = dayjs(selectedDate).endOf("day");

  const filteredUpcomingEvents = events
    .flatMap((ev) => expandBirthday(ev, selectedDate))
    // show if the event overlaps the selected day at all:
    // (event.start < dayEnd) AND (event.end > dayStart)
    .filter(
      (ev) =>
        ev &&
        dayjs(ev.start).isBefore(dayEnd) &&
        dayjs(ev.end).isAfter(dayStart)
    )
    .filter((ev) => !["completed", "missed"].includes(ev.status))
    .sort((a, b) => new Date(a.start) - new Date(b.start));


  /* ===================== ADDED: Rank ongoing + upcoming only ===================== */
  /* ===================== REPLACE your current ranking block with this ===================== */
    /* Rank ongoing + upcoming only, but give the SAME rank to overlapping events */
    const scoreMap = new Map();
    const rankMap = new Map();
    const nowTz = dayjs().tz(TZ);

    // Only rank events whose END is in the future (ongoing or upcoming).
    const rankPool = filteredUpcomingEvents
      .filter((ev) => dayjs(ev.end).isAfter(nowTz))
      .map((ev) => ({
        ev,
        startMs: +new Date(ev.start),
        endMs: +new Date(ev.end),
        score: priorityScore(ev),
      }))
      // Higher score first, then earlier start time
      .sort((a, b) => b.score - a.score || a.startMs - b.startMs);

    // Build overlap groups: if an item overlaps a group's span, it joins that group.
    // Groups merge implicitly because we expand the group's time span when adding items.
    const groups = [];
    for (const item of rankPool) {
      let placed = false;
      for (const g of groups) {
        const overlaps = item.startMs < g.maxEnd && item.endMs > g.minStart;
        if (overlaps) {
          g.items.push(item);
          g.minStart = Math.min(g.minStart, item.startMs);
          g.maxEnd = Math.max(g.maxEnd, item.endMs);
          g.bestScore = Math.max(g.bestScore, item.score);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({
          items: [item],
          minStart: item.startMs,
          maxEnd: item.endMs,
          bestScore: item.score,
        });
      }
    }

    // Order groups by best (highest) score; tie-break by earliest start
    groups.sort((a, b) => b.bestScore - a.bestScore || a.minStart - b.minStart);

    // Assign ranks per group; every event in the same group gets the SAME rank number
    groups.forEach((g, idx) => {
      const rank = idx + 1;
      g.items.forEach(({ ev, score }) => {
        const id = baseId(ev._id);
        scoreMap.set(id, score);
        rankMap.set(id, rank);
      });
    });
/* ======================================================================================= */

  // ================== FETCH OWNED/SHARED EVENTS ==================
  const fetchOwnedAndShared = useCallback(async (userId) => {
    const res = await fetch(`${API_URL}/events/${userId}`);
    const data = await res.json();

    return data.map((ev) => {
      if (String(ev.userId) === String(userId)) {
        return { ...ev, shareStatus: ev.shareStatus || {} };
      }
      return ev;
    });
  }, []);

  // ================== FETCH PENDING INCOMING REQUESTS ==================
  const fetchIncomingVirtuals = useCallback(async (userId) => {
    const res = await fetch(`${API_URL}/share-requests/incoming/${userId}?status=pending`);
    const requests = await res.json();

    return (requests || [])
      .filter((r) => r?.eventId)
      .map((r) => {
        const ev = r.eventId;
        return {
          ...ev,
          _id: `virt_${r._id}`, // virtual id; won't collide with baseId logic
          isShared: true,
          shareStatus: "pending",
          shareRequestId: r._id,
          userName: r?.senderId?.fullname || "Someone",
        };
      });
  }, []);

  // ================== MASTER FETCH ==================
  const refreshAll = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [ownedShared, incomingVirtuals] = await Promise.all([
        fetchOwnedAndShared(user.id),
        fetchIncomingVirtuals(user.id),
      ]);

      const byId = {};
      [...ownedShared, ...incomingVirtuals].forEach((e) => {
        byId[e._id] = e;
      });

      setEvents(Object.values(byId));
    } catch (err) {
      console.error("Failed to refresh events:", err);
    }
  }, [user?.id, fetchOwnedAndShared, fetchIncomingVirtuals]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ================== DOUBLE-BOOK DETECTION ==================

  useEffect(() => {
    if (!user?.id || !events.length) {
      setDoubleBookedIds([]);
      setOverlapsWithOwnedIds([]);
      return;
    }

    // Two events are from the same segmented "family" if:
    const sameFamily = (x, y) => {
      if (!x || !y) return false;
      const xid = baseId(String(x._id || ""));
      const yid = baseId(String(y._id || ""));
      const xParent = x.segmentOf ? baseId(String(x.segmentOf)) : null;
      const yParent = y.segmentOf ? baseId(String(y.segmentOf)) : null;

      return (
        xid === yid || // same event
        (xParent && xParent === yid) || // x child of y (y is parent)
        (yParent && yParent === xid) || // y child of x (x is parent)
        (xParent && yParent && xParent === yParent) // siblings (same parent)
      );
    };

    // Owned events only (no virtual, no shared, no completed/missed)
    const owned = events
      .filter(
        (e) =>
          String(e.userId) === String(user.id) && !e?.isVirtual && !e?.isShared && !e?.status
      )
      .map((e) => ({
        id: baseId(e._id),
        _id: String(e._id),
        start: new Date(e.start).getTime(),
        end: new Date(e.end).getTime(),
        ref: e,
      }))
      .sort((a, b) => a.start - b.start);

    // 1) Owned vs Owned overlaps (skip same-family)
    const ownedOwnedFlags = new Set();
    for (let i = 0; i < owned.length; i++) {
      for (let j = i + 1; j < owned.length; j++) {
        const A = owned[i];
        const B = owned[j];
        if (B.start >= A.end) break; // sorted by start; no further overlaps
        if (sameFamily(A.ref, B.ref)) continue;
        if (A.start < B.end && A.end > B.start) {
          ownedOwnedFlags.add(A.id);
          ownedOwnedFlags.add(B.id);
        }
      }
    }
    setDoubleBookedIds(Array.from(ownedOwnedFlags));

    // 2) ANY event vs Owned overlaps (covers pending shares & "keep both"), skip same-family
    const overlapsAny = new Set();
    for (const cand of events) {
      if (!cand || cand.status) continue; // ignore completed/missed
      const cStart = new Date(cand.start).getTime();
      const cEnd = new Date(cand.end).getTime();
      const cId = baseId(cand._id);

      for (const own of owned) {
        if (sameFamily(own.ref, cand)) continue;
        if (cStart < own.end && cEnd > own.start) {
          overlapsAny.add(cId);
          break;
        }
      }
    }
    setOverlapsWithOwnedIds(Array.from(overlapsAny));
  }, [events, user?.id]);

  // Use BOTH sets to decide if we show the warning badge
  const isDoubleBooked = (event) => {
    const id = baseId(event._id);
    return doubleBookedIds.includes(id) || overlapsWithOwnedIds.includes(id);
  };

  // ================== VALIDATION ==================
  useEffect(() => {
    if (!form.start) {
      setStartTimePastError("");
      return;
    }
    const phNow = dayjs().tz(TZ);
    const startTime = dayjs(form.start);
    const endTime = form.end ? dayjs(form.end) : null;

    if (editingEvent) {
      const originalStart = dayjs(editingEvent.start);
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
    const startTime = dayjs(form.start);
    const endTime = dayjs(form.end);

    if (editingEvent && startTime.isBefore(dayjs(editingEvent.start))) {
      setStartTimePastError(
        `❌ Start time cannot be earlier than original (${dayjs(editingEvent.start).format(
          "MMM D, YYYY h:mm A"
        )})`
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
          prev.map((ev) =>
            baseId(ev._id) === baseId(updated._id)
              ? { ...updated, shareStatus: ev.shareStatus || "pending" }
              : ev
          )
        );
        cancelRemindersFor(baseId(updated._id));
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
        // Server-side conflict → open CreateConflictModal
        const data = await res.json().catch(() => ({}));
        setCreateConflict({
          open: true,
          conflicts: data?.conflict ? [data.conflict] : [],
          newEvent: payload,
        });
        return;
      }

      const newEvent = await res.json();
      if (!res.ok) throw new Error(newEvent?.error || "Failed to create event");

      setEvents((prev) => [
        ...prev,
        { ...newEvent, shareStatus: newEvent.shareStatus || "pending" },
      ]);
      closeModal();
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to save event");
    }
  };

  // ================== DELETE ==================
  const handleDelete = async (id) => {
    try {
      const cleanId = baseId(id);
      await fetch(`${API_URL}/events/${cleanId}`, { method: "DELETE" });
      setEvents((prev) => prev.filter((ev) => baseId(ev._id) !== cleanId));
      cancelRemindersFor(cleanId);
    } catch (err) {
      console.error(err);
    }
  };

  // ================== STATUS ==================
  const markStatus = async (id, status) => {
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
        // 1) Update the target event
        let next = prev.map((ev) =>
          baseId(ev._id) === cleanId ? { ...ev, status: result.status } : ev
        );

        // 2) If a child completed the parent, reflect on parent
        if (result.parentUpdated && result.parent) {
          const pid = baseId(result.parent._id);
          next = next.map((ev) =>
            baseId(ev._id) === pid ? { ...ev, status: result.parent.status } : ev
          );
        }

        // 3) If a parent completed its children, reflect on children
        if (Array.isArray(result.updatedChildIds) && result.updatedChildIds.length) {
          const idSet = new Set(result.updatedChildIds.map((x) => baseId(String(x))));
          next = next.map((ev) =>
            idSet.has(baseId(ev._id)) ? { ...ev, status: "completed" } : ev
          );
        }

        return next;
      });

      // Stop reminders on the event we directly updated
      cancelRemindersFor(cleanId);

      // If we cascaded to children, clear their reminders too
      if (Array.isArray(result.updatedChildIds)) {
        result.updatedChildIds.forEach((cid) => cancelRemindersFor(baseId(String(cid))));
      }
    } catch (err) {
      console.error("Failed to update status", err);
      alert(err.message || "Failed to update status");
    }
  };

  // ================== RECIPIENT RESPONSE (UNIFIED) ==================
  const handleRecipientChoice = async (requestIdOrEventId, choice) => {
    try {
      const idForPath = requestIdOrEventId;
      const res = await fetch(`${API_URL}/share-requests/${idForPath}/respond`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }), // "keep" | "decline" | "replace"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to respond");

      // Remove the virtual incoming item
      setEvents((prev) => prev.filter((ev) => ev.shareRequestId !== idForPath));

      // If server created an event (keep/replace), add it and refresh
      if (data?.event) {
        setEvents((prev) => [...prev, data.event]);
      }

      await refreshAll();
    } catch (err) {
      console.error("❌ Error handling recipient choice:", err);
      alert(err.message || "Failed to respond");
    }
  };

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
    setConflictEvent(null);
    setEditingEvent(null);
  };

  // ================== SHARE ==================
  const handleOpenShare = (event) => {
    const clean = { ...event, _id: baseId(event._id) };
    setEventToShare(clean);
    setShareModalOpen(true);
  };

  const handleSharedEvent = () => {
    refreshAll();
  };

  // ✅ Auto conflict modal (recipient only) — includes requestId for actions
  useEffect(() => {
    if (!user) return;

    const pendingSharedEvent = events.find(
      (ev) => ev.isShared && ev.userId !== user.id && ev.shareStatus === "pending"
    );

    if (pendingSharedEvent) {
      const conflict = events.find(
        (e) =>
          e.userId === user.id &&
          dayjs(e.start).isBefore(dayjs(pendingSharedEvent.end)) &&
          dayjs(e.end).isAfter(dayjs(pendingSharedEvent.start))
      );

      if (conflict) {
        setConflictEvent({
          incoming: pendingSharedEvent,
          existing: conflict,
          requestId: pendingSharedEvent.shareRequestId,
        });
      }
    }
  }, [events, user]);

  // ================== REMINDERS ==================
  filteredUpcomingEvents.forEach((event) => {
    if (
      !event.isVirtual &&
      !event.isShared &&
      !event.status &&
      !parentIdsWithChildren.has(baseId(String(event._id))) && // don't notify a parent if it has segments
      !scheduledThisRenderRef.current[baseId(event._id)]
    ) {
      scheduleReminders(event);
      scheduledThisRenderRef.current[baseId(event._id)] = true;
    }
  });

  // ================== SEGMENTING ==================
  const openSegment = (ev) => {
    const real = canonicalizeEvent(ev);
    // FIX: block invalid/shared/virtual/zero-duration
    if (!real || real.isVirtual || real.isShared || !hasValidDuration(real)) {
      alert("This event can't be segmented: invalid/shared/virtual/zero duration.");
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
    closeSegment();
  };

  const disablePastDates = (date) => dayjs(date).isBefore(dayjs(), "day");
  const canSegmentEvent = (ev) =>
    !ev.isVirtual && !ev.isShared && hasValidDuration(ev) && dayjs(ev.end).diff(dayjs(ev.start), "minute") >= 60;

  // ------- Derived: Today counters & filtered view -------
  // Stats should NOT count parents that have children
  const statsSource = filteredUpcomingEvents.filter(
    (e) => !parentIdsWithChildren.has(baseId(String(e._id)))
  );

  const todayCount = statsSource.length;
  const overlapsCount = statsSource.filter((e) => isDoubleBooked(e)).length;
  const pendingCount = filteredUpcomingEvents.filter(
    (e) => e.isShared && e.shareStatus === "pending"
  ).length;

  let visible = [...filteredUpcomingEvents];

  if (query.trim()) {
    const q = query.toLowerCase();
    visible = visible.filter((e) => String(e.title || "").toLowerCase().includes(q));
  }

  if (view === "mine") {
    visible = visible.filter((e) => String(e.userId) === String(user?.id) && !e.isShared);
  } else if (view === "pending") {
    visible = visible.filter((e) => e.isShared && e.shareStatus === "pending");
  } else if (view === "overlaps") {
    visible = visible.filter((e) => isDoubleBooked(e));
  }

  if (urgencyFilter !== "all") {
    visible = visible.filter((e) => e.urgency === urgencyFilter);
  }
  if (importanceFilter !== "all") {
    visible = visible.filter((e) => e.importance === importanceFilter);
  }

  // Group by time blocks
  const grouped = visible.reduce((acc, ev) => {
    const blk = getTimeBlock(ev.start);
    (acc[blk] = acc[blk] || []).push(ev);
    return acc;
  }, {});

  // ----- Create-Conflict handlers (client-side) -----
  const handleCreateReplace = async () => {
    try {
      const c = createConflict.conflicts?.[0];
      const candidate = createConflict.newEvent;
      if (!c || !candidate) return setCreateConflict({ open: false, conflicts: [], newEvent: null });

      // Replace = delete the conflicting event then create the new one
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
      refreshAll();
    } catch (err) {
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

      // Re-post with allowDouble: true
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...candidate, allowDouble: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create event");

      setCreateConflict({ open: false, conflicts: [], newEvent: null });

      // Add locally, then refresh so overlap warnings recalc
      setEvents((prev) => [...prev, data]);
      await refreshAll();
    } catch (err) {
      alert(err.message || "Failed to keep both");
    }
  };

  const handleCreateReschedule = (slot) => {
    if (!slot?.start || !slot?.end) return;
    // Pre-fill the form with the suggested slot and reopen the add modal
    setCreateConflict({ open: false, conflicts: [], newEvent: null });
    setEditingEvent(null);
    setForm((prev) => ({
      ...prev,
      start: dayjs(slot.start).format("YYYY-MM-DDTHH:mm"),
      end: dayjs(slot.end).format("YYYY-MM-DDTHH:mm"),
    }));
    setShowModal(true);
  };

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
                  PH time · {dayjs().tz(TZ).format("MMM D, YYYY h:mm A")}
                </span>
              </div>

              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateCalendar value={selectedDate} onChange={setSelectedDate} shouldDisableDate={disablePastDates} />
              </LocalizationProvider>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="rounded-xl border border-green-100 bg-green-50 p-3 text-center">
                  <div className="text-xs text-gray-500">Today</div>
                  <div className="text-xl font-bold text-green-700">{todayCount}</div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-center">
                  <div className="text-xs text-gray-500">Overlaps</div>
                  <div className="text-xl font-bold text-amber-700">{overlapsCount}</div>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-center">
                  <div className="text-xs text-gray-500">Pending</div>
                  <div className="text-xl font-bold text-blue-700">{pendingCount}</div>
                </div>
              </div>

              <button
                onClick={() => openModal()}
                disabled={disablePastDates(selectedDate)}
                className={`mt-4 w-full py-2 rounded-xl font-semibold text-white transition-colors duration-200 ${
                  disablePastDates(selectedDate)
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
              {/* Sticky header for date + filters */}
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
                      {["all", "mine", "pending", "overlaps"].map((v) => (
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
                            const allowSegment = canSegmentEvent(event);
                            const isIncomingPending =
                              !!event.isShared && event.shareStatus === "pending";
                            const showOverlapWarning = isDoubleBooked(event);
                            const isSegmentChild = !!event.segmentOf;
                            const now = dayjs().tz(TZ);
                            const isOngoing =
                              now.isAfter(dayjs(event.start)) && now.isBefore(dayjs(event.end));

                            // -------------------- ADDED: read rank & score for this event
                            const eid = baseId(event._id);
                            const rk = rankMap.get(eid);
                            const sc =
                              typeof rk === "number"
                                ? scoreMap.get(eid) ?? priorityScore(event)
                                : null;
                            const showRank = typeof rk === "number";
                            // ----------------------------------------------------------

                            return (
                              <li
                                key={event._id}
                                className={[
                                  "p-4 rounded-xl shadow-sm border",
                                  "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3",
                                  "transition hover:shadow-md",
                                  showOverlapWarning ? "border-amber-300 bg-amber-50/40" : "border-gray-100 bg-white",
                                  event.status === "completed" ? "bg-green-50 border-green-200" : "",
                                  event.status === "missed" ? "bg-red-50 border-red-200" : "",
                                ].join(" ")}
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {/* Priority rank bubble (only ongoing/upcoming) */}
                                    {showRank && (
                                      <span
                                        className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-semibold ${scoreColor(
                                          sc
                                        )}`}
                                        title={`Priority rank #${rk}`}
                                      >
                                        {rk}
                                      </span>
                                    )}

                                    <p className="font-semibold text-lg text-gray-800">{event.title}</p>

                                    {/* Score chip (only when ranked) */}
                                    {showRank && (
                                      <span
                                        className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                                        title="Priority score"
                                      >
                                        score {Number(sc).toFixed(1)}
                                      </span>
                                    )}

                                    {/* Badges */}
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
                                      {event.importance === "high" ? "Important" : "Somewhat Important"}
                                    </span>

                                    {isOngoing && (
                                      <span className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                        <FiClock /> Ongoing
                                      </span>
                                    )}

                                    {showOverlapWarning && (
                                      <span className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                        <FiAlertTriangle /> Possible overlap
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-gray-600 text-sm mt-1">{formatRange(event)}</p>

                                  {event.isShared ? (
                                    <p className="text-xs text-gray-500 mt-1">
                                      Shared by {event.userName || "Someone"} — Status: <strong>{event.shareStatus}</strong>
                                    </p>
                                  ) : event.userId === user.id && event.sharedWith?.length > 0 ? (
                                    <p className="text-xs text-gray-500 mt-1">
                                      Shared with {event.sharedWith.length} people
                                    </p>
                                  ) : null}

                                  {isIncomingPending && (
                                    <div className="flex gap-2 mt-3">
                                      <button
                                        onClick={() => handleRecipientChoice(event.shareRequestId, "keep")}
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                                      >
                                        <FiCheckCircle /> Accept
                                      </button>
                                      <button
                                        onClick={() => handleRecipientChoice(event.shareRequestId, "decline")}
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                                      >
                                        <FiXCircle /> Decline
                                      </button>
                                    </div>
                                  )}

                                  {dayjs().tz(TZ).isAfter(dayjs(event.end)) && !event.status && !event.isShared && (
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
                                  {/* Hide edit/delete/split/share for incoming virtuals */}
                                  {!event.status && !event.isShared && (
                                    <button
                                      onClick={() => openModal(event)}
                                      title="Edit"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-yellow-400 text-white hover:bg-yellow-500"
                                    >
                                      <FiEdit2 />
                                      <span className="hidden sm:inline">Edit</span>
                                    </button>
                                  )}
                                  {!event.status && !event.isShared && (
                                    <button
                                      onClick={() => handleDelete(event._id)}
                                      title="Delete"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600"
                                    >
                                      <FiTrash2 />
                                      <span className="hidden sm:inline">Delete</span>
                                    </button>
                                  )}
                                  {!event.status && !event.isShared && allowSegment && (
                                    <button
                                      onClick={() => openSegment(event)}
                                      title="Split into segments"
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-purple-600 text-white hover:bg-purple-700"
                                    >
                                      <FiScissors />
                                      <span className="hidden sm:inline">Split</span>
                                    </button>
                                  )}
                                  {!event.status &&
                                    !event.isShared &&
                                    event.userId === user.id &&
                                    !event.isVirtual &&
                                    !isSegmentChild && (
                                      <button
                                        onClick={() => handleOpenShare(event)}
                                        title="Share"
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                                      >
                                        <FiShare2 />
                                        <span className="hidden sm:inline">Share</span>
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

      <ConflictModal
        isOpen={!!conflictEvent}
        conflict={conflictEvent}
        onClose={() => {
          setConflictEvent(null);
          refreshAll();
        }}
      />

      <ShareModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        eventId={eventToShare?._id ? String(eventToShare._id).split("-")[0] : undefined}
        senderId={user?.id}
        onShared={handleSharedEvent}
        senderEmail={senderEmail}
      />

      <SegmentModal isOpen={segmentOpen} onClose={closeSegment} event={segmentTarget} onSplitSuccess={handleSplitSuccess} />

      <CreateConflictModal
        isOpen={createConflict.open}
        onClose={() => setCreateConflict({ open: false, conflicts: [], newEvent: null })}
        conflicts={createConflict.conflicts}
        suggestions={[]}
        onReplace={handleCreateReplace}
        onKeep={handleCreateKeep}
        onReschedule={handleCreateReschedule}
        newEventTitle={createConflict.newEvent?.title}
        newEventStart={createConflict.newEvent?.start}
        newEventEnd={createConflict.newEvent?.end}
      />

    </div>
  );
}
