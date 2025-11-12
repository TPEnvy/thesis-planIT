// src/components/CreateConflictModal.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import dayjs from "dayjs";

/**
 * Props:
 * - isOpen
 * - onClose
 * - conflicts: Array<{ _id, title, start, end, importance, urgency, difficulty }>
 * - suggestions: optional array of { start, end }
 * - onReplace: () => void
 * - onKeep: () => void
 * - onReschedule: (slot: {start: Date, end: Date}) => void
 * - newEvent: { title, start, end, importance, urgency, difficulty }
 */
export default function CreateConflictModal({
  isOpen,
  onClose,
  conflicts = [],
  suggestions = [],
  onReplace,
  onKeep,
  onReschedule,
  newEvent = null,
}) {
  const [confirmKeep, setConfirmKeep] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);

  // --- helpers ---
  const toMs = (v) => {
    try {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : NaN;
    } catch {
      return NaN;
    }
  };

  // Duration of the candidate new event, fallback 60 minutes
  const newEventDurationMin = useMemo(() => {
    if (!newEvent) return 60;
    const s = toMs(newEvent.start);
    const e = toMs(newEvent.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 60;
    return Math.max(1, Math.round((e - s) / 60000));
  }, [newEvent]);

  // ✅ EXACT match (same start & same end, ignore attributes)
  const exactConflicts = useMemo(() => {
    if (!newEvent || !Array.isArray(conflicts) || conflicts.length === 0) return [];
    const ns = toMs(newEvent.start);
    const ne = toMs(newEvent.end);
    if (!Number.isFinite(ns) || !Number.isFinite(ne)) return [];
    return conflicts.filter((c) => toMs(c.start) === ns && toMs(c.end) === ne);
  }, [conflicts, newEvent]);

  // Build suggestions only when exact conflicts exist.
  const buildSuggestions = useCallback(() => {
    if (!newEvent || exactConflicts.length === 0) return [];

    // Use the latest conflicting end (or now) as base
    const latestEnd = exactConflicts.reduce((acc, c) => {
      const ce = dayjs(c.end);
      return ce.isAfter(acc) ? ce : acc;
    }, dayjs(exactConflicts[0].end));

    const now = dayjs();
    const baseStart = latestEnd.isAfter(now) ? latestEnd : now;
    const dur = newEventDurationMin;

    const opt1Start = baseStart;
    const opt1End = opt1Start.add(dur, "minute");

    const opt2Start = baseStart.add(1, "hour");
    const opt2End = opt2Start.add(dur, "minute");

    const opt3Start = now.add(1, "day").startOf("day").hour(8).minute(0).second(0);
    const opt3End = opt3Start.add(dur, "minute");

    const fmt = (s, e) =>
      (s.isSame(e, "day")
        ? `${s.format("MMM D, h:mm A")} – ${e.format("h:mm A")}`
        : `${s.format("MMM D, h:mm A")} – ${e.format("MMM D, h:mm A")}`);

    return [
      {
        key: "after",
        start: opt1Start.toDate(),
        end: opt1End.toDate(),
        label: fmt(opt1Start, opt1End),
        hint: "After conflict",
      },
      {
        key: "plus1h",
        start: opt2Start.toDate(),
        end: opt2End.toDate(),
        label: fmt(opt2Start, opt2End),
        hint: "+1 hour",
      },
      {
        key: "tomorrow8",
        start: opt3Start.toDate(),
        end: opt3End.toDate(),
        label: fmt(opt3Start, opt3End),
        hint: "Tomorrow 8:00 AM",
      },
    ];
  }, [exactConflicts, newEvent, newEventDurationMin]);

  // Only compute suggestions when: open + exact matches exist.
  useEffect(() => {
    if (!isOpen) return;
    if (exactConflicts.length === 0) {
      setAvailableSlots([]);
      return;
    }

    // Prefer external suggestions (if provided)
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      const mapped = suggestions.map((slot, i) => {
        const s = dayjs(slot.start);
        const e = dayjs(slot.end);
        const sameDay = s.isSame(e, "day");
        const label = sameDay
          ? `${s.format("MMM D, h:mm A")} – ${e.format("h:mm A")}`
          : `${s.format("MMM D, h:mm A")} – ${e.format("MMM D, h:mm A")}`;
        return {
          key: `ext-${i}`,
          start: s.toDate(),
          end: e.toDate(),
          label,
          hint: "Suggested",
        };
      });
      setAvailableSlots(mapped);
      return;
    }

    setAvailableSlots(buildSuggestions());
  }, [isOpen, exactConflicts, suggestions, buildSuggestions]);

  // Reset confirm state on close
  useEffect(() => {
    if (!isOpen) setConfirmKeep(false);
  }, [isOpen]);

  // 🔒 Show nothing unless: modal is open AND there are exact matches
  if (!isOpen || exactConflicts.length === 0) return null;

  const handleKeepClick = () => {
    if (!confirmKeep) {
      setConfirmKeep(true);
      return;
    }
    onKeep?.();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg">
        <h2 className="text-xl font-bold mb-2">Exact Time Conflict</h2>

        <p className="text-sm text-gray-600 mb-4">
          Your new event exactly matches the time of {exactConflicts.length} existing event
          {exactConflicts.length !== 1 ? "s" : ""} (same start and end).
        </p>

        <div className="mb-4 max-h-40 overflow-y-auto">
          {exactConflicts.map((c) => {
            const s = dayjs(c.start);
            const e = dayjs(c.end);
            const sameDay = s.isSame(e, "day");
            return (
              <div key={c._id} className="text-sm text-gray-700 border rounded p-2 mb-2">
                <div className="font-semibold">{c.title}</div>
                <div>
                  {sameDay
                    ? `${s.format("MMM D, h:mm A")} – ${e.format("h:mm A")}`
                    : `${s.format("MMM D, h:mm A")} – ${e.format("MMM D, h:mm A")}`}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Difficulty: {c.difficulty || "medium"} · Urgency: {c.urgency} · Importance: {c.importance}
                </div>
              </div>
            );
          })}
        </div>

        {availableSlots.length > 0 && (
          <>
            <h3 className="text-sm font-semibold mb-2">Suggested times</h3>
            <div className="grid grid-cols-1 gap-2 mb-4">
              {availableSlots.map((slot) => (
                <button
                  key={slot.key ?? `${slot.start}-${slot.end}`}
                  onClick={() => onReschedule?.({ start: slot.start, end: slot.end })}
                  className="w-full text-left border rounded p-2 hover:bg-green-50"
                >
                  <div className="font-medium">{slot.label}</div>
                  <div className="text-xs text-gray-600">{slot.hint}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {confirmKeep && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">Heads up before keeping both:</p>
            <ul className="mt-1 text-xs text-amber-800 list-disc pl-5 space-y-1">
              <li>You will be <b>double-booked</b> during that time.</li>
              <li>If these are the <b>same task</b>, consider replacing or rescheduling.</li>
              <li>You can adjust later—edit one event or split it.</li>
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={onReplace}
            className="flex-1 px-4 py-2 rounded bg-yellow-500 text-white hover:bg-yellow-600"
            title="Replace the existing conflicting event with the new one"
          >
            Replace Existing
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <button
            onClick={handleKeepClick}
            className="flex-1 px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
            title="Keep both events (double-book)"
          >
            {confirmKeep ? "Confirm Keep (Double-book)" : "Keep (Double-book)"}
          </button>

          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded bg-gray-300 hover:bg-gray-400 text-gray-800"
          >
            Cancel
          </button>
        </div>

        {confirmKeep && (
          <div className="mt-2 text-[11px] text-gray-500">
            Tip: Use “Suggested times” above to quickly reschedule instead.
          </div>
        )}
      </div>
    </div>
  );
}
