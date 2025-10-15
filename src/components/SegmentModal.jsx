// src/components/SegmentModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
const TZ = "Asia/Manila";

// Strip "virt_" and optional trailing "-YYYY" (keep real UUID/ObjectId intact)
const baseId = (v = "") => {
  const s = String(v || "");
  const noVirt = s.startsWith("virt_") ? s.slice(5) : s;
  return noVirt.replace(/-\d{4}$/, "");
};

const toTz = (d) => dayjs(d).tz(TZ);

export default function SegmentModal({ isOpen, onClose, event, onSplitSuccess }) {
  const [mode, setMode] = useState("byCount"); // "byCount" | "byDuration"
  const [count, setCount] = useState(2);
  const [segmentMinutes, setSegmentMinutes] = useState(30);
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [titlePrefix, setTitlePrefix] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const dialogRef = useRef(null);

  // Scroll lock + ESC close + focus trap (hooks always run; logic gated inside)
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);

    const root = dialogRef.current;
    const selector =
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(root?.querySelectorAll(selector) || []).filter(
        (n) => !n.hasAttribute("disabled")
      );
    const onKeydown = (e) => {
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root?.addEventListener("keydown", onKeydown);

    return () => {
      document.removeEventListener("keydown", onKey);
      root?.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  // Reset state when opening
  useEffect(() => {
    if (!isOpen) return;
    setMode("byCount");
    setCount(2);
    setSegmentMinutes(30);
    setBreakMinutes(0);
    setTitlePrefix("");
    setSubmitting(false);
    setErr("");
  }, [isOpen]);

  // Compute total minutes safely even when event is undefined (hook must run every render)
  const totalMin = useMemo(() => {
    if (!event) return 0;
    const start = toTz(event.start);
    const end = toTz(event.end);
    if (!start.isValid() || !end.isValid()) return 0;
    return Math.max(0, end.diff(start, "minute"));
  }, [event]);

  // Derived preview + validation (hook runs every render; uses safe totalMin)
  const { valid, preview, computedCount } = useMemo(() => {
    let ok = true;
    let previewText = "";
    let cCount = 0;

    const nBreak = Math.max(0, Number(breakMinutes) || 0);
    const breaksTotalFor = (n) => Math.max(0, n - 1) * nBreak;

    if (totalMin <= 0) {
      return { valid: false, preview: "This event has zero/invalid duration.", computedCount: 0 };
    }

    if (mode === "byCount") {
      const n = Math.max(1, Number(count) || 0);
      const usable = totalMin - breaksTotalFor(n);
      if (usable <= 0) {
        ok = false;
        previewText = `Not enough time for ${n} segments with ${nBreak}m breaks.`;
      } else {
        const per = Math.floor(usable / n);
        if (per <= 0) {
          ok = false;
          previewText = `Not enough time for ${n} segments with ${nBreak}m breaks.`;
        } else {
          cCount = n;
          previewText = `Will create ${n} segment${n > 1 ? "s" : ""} of ~${per} min each`;
        }
      }
    } else {
      const perSeg = Math.max(1, Number(segmentMinutes) || 0);
      const denom = perSeg + nBreak;
      const n = Math.floor((totalMin + nBreak) / Math.max(1, denom));
      if (n <= 0) {
        ok = false;
        previewText = `Not enough time for ${perSeg}m segments with ${nBreak}m breaks.`;
      } else {
        cCount = n;
        previewText = `Will create ${n} segment${n > 1 ? "s" : ""} of ${perSeg} min each`;
      }
    }

    return { valid: ok, preview: previewText, computedCount: cCount };
  }, [mode, count, segmentMinutes, breakMinutes, totalMin]);

  // ✅ Hooks are all above; safe to early-return now
  if (!isOpen || !event) return null;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!valid) {
      setErr("Please adjust segments or breaks so total time fits.");
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const body =
        mode === "byCount"
          ? {
              mode,
              count: Number(count),
              breakMinutes: Math.max(0, Number(breakMinutes) || 0),
              titlePrefix: titlePrefix || undefined,
            }
          : {
              mode,
              segmentMinutes: Number(segmentMinutes),
              breakMinutes: Math.max(0, Number(breakMinutes) || 0),
              titlePrefix: titlePrefix || undefined,
            };

      const res = await fetch(`${API_BASE}/events/${baseId(event._id)}/split`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to split");

      onSplitSuccess?.(data.segments || []);
      onClose?.();
    } catch (e2) {
      setErr(e2.message || "Failed to split");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="segment-modal-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="segment-modal-title" className="text-lg font-semibold">
          Segment “{event.title}”
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          Total time selected: <b>{totalMin} min</b> (PH time).
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                value="byCount"
                checked={mode === "byCount"}
                onChange={() => setMode("byCount")}
              />
              <span className="text-sm">By number of segments</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                value="byDuration"
                checked={mode === "byDuration"}
                onChange={() => setMode("byDuration")}
              />
              <span className="text-sm">By minutes per segment</span>
            </label>
          </div>

          {mode === "byCount" ? (
            <div>
              <label className="block text-sm mb-1">How many segments?</label>
              <input
                type="number"
                min={1}
                className="w-full border rounded-lg p-2"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm mb-1">Minutes per segment</label>
              <input
                type="number"
                min={1}
                className="w-full border rounded-lg p-2"
                value={segmentMinutes}
                onChange={(e) => setSegmentMinutes(e.target.value)}
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm mb-1">Break between segments (min)</label>
            <input
              type="number"
              min={0}
              className="w-full border rounded-lg p-2"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Child title prefix (optional)</label>
            <input
              type="text"
              className="w-full border rounded-lg p-2"
              placeholder={event.title}
              value={titlePrefix}
              onChange={(e) => setTitlePrefix(e.target.value)}
            />
          </div>

          {/* Live preview / validation */}
          <div
            className={`text-sm rounded-lg p-2 ${
              valid
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-yellow-50 text-yellow-800 border border-yellow-200"
            }`}
          >
            {preview}
            {valid && computedCount > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                {breakMinutes > 0
                  ? `Includes ${breakMinutes} min break between segments.`
                  : "No breaks between segments."}
              </div>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="px-3 py-1 rounded-lg border"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 rounded-lg bg-purple-600 text-white disabled:opacity-60"
              disabled={submitting || !valid}
              title={!valid ? "Adjust segments/breaks to fit total time" : "Split event"}
            >
              {submitting ? "Splitting…" : "Split"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
