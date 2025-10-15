// src/components/ShowModal.jsx
import React, { useEffect, useMemo, useRef, useCallback } from "react";
import { FiX, FiCalendar, FiClock, FiFlag, FiAlertTriangle, FiAward } from "react-icons/fi";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Manila";
const fmtLocal = (d) => dayjs(d).tz(TZ);

export default function ShowModal({
  show,
  closeModal,
  handleSubmit,
  handleChange,   // expects { target: { name, value } }
  form,
  editingEvent,
  formError,
  startTimePastError,
}) {
  const dialogRef = useRef(null);
  const titleInputRef = useRef(null);

  // Scroll lock while open
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  // Close on ESC
  useEffect(() => {
    if (!show) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, closeModal]);

  // Autofocus title on open
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => titleInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [show]);

  // Focus trap
  useEffect(() => {
    if (!show) return;
    const root = dialogRef.current;
    if (!root) return;

    const selector =
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(root.querySelectorAll(selector)).filter(
      (n) => !n.hasAttribute("disabled")
    );
    if (!nodes.length) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    const onKeydown = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKeydown);
    return () => root.removeEventListener("keydown", onKeydown);
  }, [show]);

  // Derived: duration (PH time)
  const durationText = useMemo(() => {
    if (!form?.start || !form?.end) return "";
    const s = fmtLocal(form.start);
    const e = fmtLocal(form.end);
    if (!s.isValid() || !e.isValid() || !e.isAfter(s)) return "";
    const diffMin = e.diff(s, "minute");
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }, [form?.start, form?.end]);

  const disableSubmit =
    !form?.title || !form?.start || !form?.end || !!formError || !!startTimePastError;

  // ✅ Hook BEFORE early return: ensure end >= start
  const ensureEndAfterStart = useCallback(
    (startIso, keepIfValid = false) => {
      const s = fmtLocal(startIso);
      const currentEnd = form?.end ? fmtLocal(form.end) : null;
      if (keepIfValid && currentEnd && currentEnd.isAfter(s)) return;
      const newEnd = s.add(1, "hour").format("YYYY-MM-DDTHH:mm");
      handleChange({ target: { name: "end", value: newEnd } });
    },
    [form?.end, handleChange]
  );

  if (!show) return null;

  // Backdrop close (click outside)
  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget) closeModal?.();
  };

  const onStartChange = (e) => {
    handleChange(e);
    const startIso = e.target.value;
    const s = fmtLocal(startIso);
    const end = form?.end ? fmtLocal(form.end) : null;
    if (!end || !end.isAfter(s)) {
      ensureEndAfterStart(startIso);
    }
  };

  const setDuration = (minutes) => {
    if (!form?.start) return;
    const s = fmtLocal(form.start);
    const newEnd = s.add(minutes, "minute").format("YYYY-MM-DDTHH:mm");
    handleChange({ target: { name: "end", value: newEnd } });
  };

  // Min values (hints only; parent/server still validate)
  const minStart = editingEvent
    ? fmtLocal(editingEvent.start).format("YYYY-MM-DDTHH:mm")
    : fmtLocal().format("YYYY-MM-DDTHH:mm");
  const minEnd = form?.start ? fmtLocal(form.start).format("YYYY-MM-DDTHH:mm") : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-modal-title"
      aria-describedby="event-modal-desc"
      onMouseDown={onBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 sm:pt-6">
          <div>
            <h2 id="event-modal-title" className="text-xl sm:text-2xl font-bold text-gray-900">
              {editingEvent ? "Edit Event" : "Add Event"}
            </h2>
            <p id="event-modal-desc" className="text-xs sm:text-sm text-gray-500">
              Times are saved in {TZ}. Current time: {fmtLocal().format("MMM D, YYYY h:mm A")}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
            title="Close"
          >
            <FiX className="text-lg" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 sm:px-6 pb-5 sm:pb-6">
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Title */}
            <div className="sm:col-span-12">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Title
              </label>
              <div className="relative">
                <input
                  id="title"
                  ref={titleInputRef}
                  type="text"
                  name="title"
                  placeholder="e.g., Study, Team meeting, Workout"
                  value={form.title}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pl-10 outline-none focus:ring-2 focus:ring-green-600"
                />
                <FiAward className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Start */}
            <div className="sm:col-span-6">
              <label htmlFor="start" className="block text-sm font-medium text-gray-700 mb-1">
                Start
              </label>
              <div className="relative">
                <input
                  id="start"
                  type="datetime-local"
                  name="start"
                  value={form.start}
                  onChange={onStartChange}
                  min={minStart}
                  step={60}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pl-10 outline-none focus:ring-2 focus:ring-green-600"
                  aria-invalid={!!startTimePastError}
                />
                <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                <FiClock /> Start date & time
              </p>
            </div>

            {/* End */}
            <div className="sm:col-span-6">
              <label htmlFor="end" className="block text-sm font-medium text-gray-700 mb-1">
                End
              </label>
              <div className="relative">
                <input
                  id="end"
                  type="datetime-local"
                  name="end"
                  value={form.end}
                  onChange={handleChange}
                  min={minEnd}
                  step={60}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pl-10 outline-none focus:ring-2 focus:ring-green-600"
                  aria-invalid={!!formError}
                />
                <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                <FiClock /> End date & time
              </p>
            </div>

            {/* Quick duration chips */}
            <div className="sm:col-span-12 -mt-2">
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "25m", m: 25 },
                  { label: "45m", m: 45 },
                  { label: "1h", m: 60 },
                  { label: "90m", m: 90 },
                  { label: "2h", m: 120 },
                ].map((d) => (
                  <button
                    key={d.m}
                    type="button"
                    onClick={() => setDuration(d.m)}
                    className="text-xs px-2.5 py-1 rounded-full border border-gray-300 hover:bg-gray-50"
                    title={`Set duration to ${d.label}`}
                    disabled={!form?.start}
                  >
                    {d.label}
                  </button>
                ))}
                {durationText && (
                  <span className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-700">
                    <FiClock className="text-[11px]" />
                    {durationText}
                  </span>
                )}
              </div>
            </div>

            {/* Importance */}
            <div className="sm:col-span-4">
              <label htmlFor="importance" className="block text-sm font-medium text-gray-700 mb-1">
                Importance
              </label>
              <div className="relative">
                <select
                  id="importance"
                  name="importance"
                  value={form.importance}
                  onChange={handleChange}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-9 outline-none focus:ring-2 focus:ring-green-600"
                >
                  <option value="low">Somewhat Important</option>
                  <option value="high">Important</option>
                </select>
                <FiFlag className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Urgency */}
            <div className="sm:col-span-4">
              <label htmlFor="urgency" className="block text-sm font-medium text-gray-700 mb-1">
                Urgency
              </label>
              <div className="relative">
                <select
                  id="urgency"
                  name="urgency"
                  value={form.urgency}
                  onChange={handleChange}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-9 outline-none focus:ring-2 focus:ring-green-600"
                >
                  <option value="low">Somewhat Urgent</option>
                  <option value="high">Urgent</option>
                </select>
                <FiAlertTriangle className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Difficulty */}
            <div className="sm:col-span-4">
              <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700 mb-1">
                Difficulty
              </label>
              <div className="relative">
                <select
                  id="difficulty"
                  name="difficulty"
                  value={form.difficulty}
                  onChange={handleChange}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-9 outline-none focus:ring-2 focus:ring-green-600"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <FiAward className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Errors */}
            {(formError || startTimePastError) && (
              <div className="sm:col-span-12">
                {formError && (
                  <p
                    className="text-sm rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2"
                    role="alert"
                    aria-live="polite"
                  >
                    {formError}
                  </p>
                )}
                {startTimePastError && (
                  <p
                    className="mt-2 text-sm rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2"
                    role="alert"
                    aria-live="polite"
                  >
                    {startTimePastError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disableSubmit}
              className={[
                "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white",
                disableSubmit ? "bg-green-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700",
              ].join(" ")}
            >
              {editingEvent ? "Update Event" : "Add Event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
