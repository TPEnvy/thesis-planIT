// src/components/CreateConflictModal.jsx
import React, { useEffect, useState, useCallback } from "react";
import dayjs from "dayjs";

/**
 * Props:
 * - isOpen
 * - onClose
 * - conflicts: Array<{ _id, title, start, end }>
 * - suggestions: optional array of { start, end } slots  (if provided, these will be shown instead)
 * - onReplace: () => void
 * - onKeep: () => void
 * - onReschedule: (slot) => void
 * - newEventTitle: optional string; if provided, we'll warn if titles match
 */
export default function CreateConflictModal({
  isOpen,
  onClose,
  conflicts = [],
  suggestions = [],
  onReplace,
  onKeep,
  onReschedule,
  newEventTitle, // optional
}) {
  const [availableSlots, setAvailableSlots] = useState([]);
  const [confirmKeep, setConfirmKeep] = useState(false); // step-2 confirmation

  const DEFAULT_DURATION_MIN = 60; // default event duration for suggestions

  // normalize helper (for title comparison)
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  // detect "same task" if newEventTitle provided
  const maybeSameTask =
    !!newEventTitle &&
    conflicts.some((c) => norm(c.title) && norm(c.title) === norm(newEventTitle));

  const formatSlotRange = (slot) => {
    const s = dayjs(slot.start);
    const e = dayjs(slot.end);
    const sameDay = s.isSame(e, "day");
    return sameDay
      ? `${s.format("MMM D, h:mm A")} – ${e.format("h:mm A")}`
      : `${s.format("MMM D, h:mm A")} – ${e.format("MMM D, h:mm A")}`;
  };

  // Build 3 friendly suggestions based on the latest conflict end (or now)
  const buildUpcomingSuggestions = useCallback(() => {
    if (!conflicts.length) return [];

    // Get the latest end among conflicts
    let latestEnd = dayjs(conflicts[0].end);
    for (let i = 1; i < conflicts.length; i++) {
      const e = dayjs(conflicts[i].end);
      if (e.isAfter(latestEnd)) latestEnd = e;
    }

    const now = dayjs();
    const baseStart = latestEnd.isAfter(now) ? latestEnd : now; // if conflict already ended, start from "now"
    const dur = DEFAULT_DURATION_MIN;

    const opt1Start = baseStart;
    const opt1End = opt1Start.add(dur, "minute");

    const opt2Start = baseStart.add(1, "hour");
    const opt2End = opt2Start.add(dur, "minute");

    const opt3Start = now.add(1, "day").startOf("day").hour(8).minute(0).second(0);
    const opt3End = opt3Start.add(dur, "minute");

    const s1 = { key: "after", start: opt1Start.toDate(), end: opt1End.toDate(), hint: "After current conflict" };
    const s2 = { key: "plus1h", start: opt2Start.toDate(), end: opt2End.toDate(), hint: "+1 hour" };
    const s3 = { key: "tomorrow8", start: opt3Start.toDate(), end: opt3End.toDate(), hint: "Tomorrow 8:00 AM" };

    return [s1, s2, s3].map((s) => ({ ...s, label: formatSlotRange(s) }));
  }, [conflicts]);

  // Refresh suggestions whenever the modal opens or conflicts change
  useEffect(() => {
    if (!isOpen) return;

    if (suggestions.length > 0) {
      // Use external suggestions if provided
      setAvailableSlots(
        suggestions.map((slot, i) => {
          const s = { start: new Date(slot.start), end: new Date(slot.end) };
          return {
            key: `ext-${i}`,
            label: formatSlotRange(s),
            hint: "Suggested",
            start: s.start,
            end: s.end,
          };
        })
      );
      return;
    }

    if (conflicts.length > 0) {
      setAvailableSlots(buildUpcomingSuggestions());
    } else {
      setAvailableSlots([]);
    }
  }, [isOpen, conflicts, suggestions, buildUpcomingSuggestions]);

  // reset confirmation state whenever modal closes
  useEffect(() => {
    if (!isOpen) setConfirmKeep(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeepClick = () => {
    if (!confirmKeep) {
      setConfirmKeep(true);
      return;
    }
    onKeep?.();
  };

  // Prefer internal/external computed slots
  const timeSuggestions = availableSlots;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg">
        <h2 className="text-xl font-bold mb-2">Time Conflict Detected</h2>
        <p className="text-sm text-gray-600 mb-4">
          Your new event overlaps with {conflicts.length} existing event
          {conflicts.length !== 1 ? "s" : ""}.
        </p>

        <div className="mb-4 max-h-40 overflow-y-auto">
          {conflicts.map((c) => {
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
              </div>
            );
          })}
        </div>

        {/* Suggestions */}
        {timeSuggestions.length > 0 && (
          <>
            <h3 className="text-sm font-semibold mb-2">Suggested times</h3>
            <div className="grid grid-cols-1 gap-2 mb-4">
              {timeSuggestions.map((slot) => (
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

        {/* Keep confirmation / warnings */}
        {confirmKeep && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">Heads up before keeping both:</p>
            <ul className="mt-1 text-xs text-amber-800 list-disc pl-5 space-y-1">
              <li>
                You will be <b>double-booked</b> during the overlapping time and might miss one of
                the events.
              </li>
              {maybeSameTask ? (
                <li>
                  The incoming event seems to be the <b>same task</b> (same title) as one of the
                  conflicts. Consider replacing or rescheduling to avoid duplication.
                </li>
              ) : (
                <li>
                  If these represent the <b>same task</b>, consider replacing or rescheduling to
                  avoid duplication.
                </li>
              )}
              <li>You can always adjust later—edit one of the events or split it into segments.</li>
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={onReplace}
            className="flex-1 px-4 py-2 rounded bg-yellow-500 text-white hover:bg-yellow-600"
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
