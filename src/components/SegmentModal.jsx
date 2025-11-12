// src/components/SegmentModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
const TZ = "Asia/Manila";

// helpers: strip virt_ prefix and trailing -YYYY if present
const baseId = (v = "") => {
  const s = String(v || "");
  const noVirt = s.startsWith("virt_") ? s.slice(5) : s;
  return noVirt.replace(/-\d{4}$/, "");
};
const toTz = (d) => dayjs(d).tz(TZ);

// Difficulty chunk percentages (P)
const DIFF_P = {
  easy: 0.6,
  medium: 0.75,
  hard: 0.85,
};

// Urgency "weight" for determining segment count (Uweight)
const URG_WEIGHT = {
  low: 0.5,
  high: 1.0,
};

// Urgency reduces break fraction slightly (higher urgency -> smaller break fraction)
const URG_BREAK_REDUCER = {
  low: 0.05,
  high: 0.1,
};

export default function SegmentModal({ isOpen, onClose, event, onSplitSuccess }) {
  // Inputs & UI state
  const [titlePrefix, setTitlePrefix] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [segmentNames, setSegmentNames] = useState([]);

  const dialogRef = useRef(null);

  // Auto parameters
  const baseBreakFrac = 0.2; // default base break fraction (20%)
  const minSegMin = 30; // minimum segment length in minutes (safeguard)

  // Modal lifecycle hooks (scroll lock / focus trap / ESC)
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
      Array.from(root?.querySelectorAll(selector) || []).filter((n) => !n.hasAttribute("disabled"));
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
    setTitlePrefix("");
    setSubmitting(false);
    setErr("");
    setSegmentNames([]);
  }, [isOpen]);

  // compute total minutes safely
  const totalMin = useMemo(() => {
    if (!event) return 0;
    const s = toTz(event.start);
    const e = toTz(event.end);
    if (!s.isValid() || !e.isValid() || !e.isAfter(s)) return 0;
    return Math.max(0, e.diff(s, "minute"));
  }, [event]);

  // Auto segmentation algorithm
  const autoResult = useMemo(() => {
    if (!event || totalMin <= 0) {
      return {
        valid: false,
        reason: "Invalid event duration",
        segments: [],
        count: 0,
        perBreakMin: 0,
        segmentMinutes: 0,
      };
    }

    // Duration in hours
    const D = totalMin / 60;
    const diffKey = (event.difficulty || "medium").toLowerCase();
    const urgencyKey = (event.urgency || "low").toLowerCase();

    const P = DIFF_P[diffKey] ?? DIFF_P.medium;
    const Uweight = URG_WEIGHT[urgencyKey] ?? URG_WEIGHT.low;
    const urgencyReducer = URG_BREAK_REDUCER[urgencyKey] ?? URG_BREAK_REDUCER.low;

    // raw segment count
    let S_raw = Math.max(1, D * P * Uweight);
    let S = Math.max(1, Math.ceil(S_raw));
    const maxS = Math.max(1, Math.floor(totalMin / Math.max(1, minSegMin)));
    if (S > maxS) S = maxS;

    // break fraction adjusted by urgency
    const bf = Math.max(0, baseBreakFrac - urgencyReducer);

    // initial raw per-segment minutes
    let rawSegMin = Math.floor(totalMin / S);
    let perBreakMin = Math.floor(rawSegMin * bf);
    let segMin = Math.floor((totalMin - perBreakMin * (S - 1)) / S);

    // ensure every segment meets minSegMin by decreasing S until it does
    while (S > 1 && segMin < minSegMin) {
      S = S - 1;
      rawSegMin = Math.floor(totalMin / S);
      perBreakMin = Math.floor(rawSegMin * bf);
      segMin = Math.floor((totalMin - perBreakMin * (S - 1)) / S);
    }

    // build plan
    const plan = [];
    let cursor = toTz(event.start).valueOf();
    for (let i = 0; i < S; i++) {
      const startMs = cursor;
      const thisEnd = startMs + segMin * 60 * 1000;
      const endMs = i === S - 1 ? toTz(event.end).valueOf() : Math.min(thisEnd, toTz(event.end).valueOf());
      plan.push({ startMs, endMs });
      cursor = endMs + perBreakMin * 60 * 1000;
    }

    const segments = plan.map((p, i) => ({
      index: i,
      start: new Date(p.startMs),
      end: new Date(p.endMs),
      minutes: Math.round((p.endMs - p.startMs) / 60000),
      title: `${titlePrefix || event.title} — Segment ${i + 1}`,
    }));

    return {
      valid: S >= 1 && segments.length > 0,
      reason: S >= 1 ? "" : "Not enough time",
      segments,
      count: S,
      perBreakMin,
      segmentMinutes: segMin,
      baseBreakFrac,
      bf,
      P,
      Uweight,
      S_raw,
    };
  }, [event, totalMin, titlePrefix]);

  // Prepare editable names when autoResult changes
  useEffect(() => {
    if (!isOpen) return;
    const names = autoResult.segments.map((s) => s.title);
    setSegmentNames(names);
  }, [isOpen, autoResult]);

  const canSplit = autoResult.valid && autoResult.count > 1;

  const handleNameChange = (i, v) => {
    setSegmentNames((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    if (!autoResult.valid) {
      setErr("Invalid segmentation — adjust parameters.");
      return;
    }
    if (!canSplit) {
      setErr("Nothing to split (only 1 segment).");
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const body = {
        mode: "byCount",
        count: autoResult.count,
        breakMinutes: autoResult.perBreakMin || 0,
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

      const createdSegments = data.segments || [];

      // Best-effort rename created children to match edited names
      for (let i = 0; i < createdSegments.length; i++) {
        const cs = createdSegments[i];
        const wantTitle = segmentNames[i];
        if (wantTitle && wantTitle.trim() && wantTitle.trim() !== cs.title) {
          try {
            await fetch(`${API_BASE}/events/${baseId(cs._id)}`, {
              method: "PUT",
              headers,
              credentials: "include",
              body: JSON.stringify({ title: wantTitle.trim() }),
            });
          } catch {
            // ignore rename failure
          }
        }
      }

      onSplitSuccess?.(data.segments || createdSegments);
      onClose?.();
    } catch (e2) {
      setErr(e2.message || "Failed to split");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !event) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="segment-modal-title"
    >
      <div ref={dialogRef} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="segment-modal-title" className="text-lg font-semibold mb-2">
          Auto Segment “{event.title}”
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          Total time: <b>{totalMin} min</b> ({Math.round((totalMin / 60) * 100) / 100} hours).
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div className="text-sm text-gray-700">
            Computed segments: <b>{autoResult.count}</b>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div>Per segment ≈ <b>{autoResult.segmentMinutes} min</b></div>
            <div>Per break ≈ <b>{autoResult.perBreakMin} min</b></div>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Difficulty factor: {autoResult.P ? autoResult.P : "—"}, urgency weight: {autoResult.Uweight ? autoResult.Uweight : "—"}
          </div>

          <div>
            <label className="block text-sm mb-1">Child title prefix (optional)</label>
            <input type="text" className="w-full border rounded-lg p-2" placeholder={event.title} value={titlePrefix} onChange={(e) => setTitlePrefix(e.target.value)} />
          </div>

          {autoResult.segments && autoResult.segments.length > 0 && (
            <div className="border rounded p-2 bg-gray-50">
              <div className="text-sm font-semibold mb-2">Segment names</div>
              <div className="space-y-2 max-h-48 overflow-auto">
                {autoResult.segments.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="w-8 text-xs text-gray-600">#{i + 1}</div>
                    <input
                      type="text"
                      className="flex-1 border rounded p-1 text-sm"
                      value={segmentNames[i] ?? s.title}
                      onChange={(e) => handleNameChange(i, e.target.value)}
                    />
                    <div className="text-xs text-gray-500 w-24 text-right">{s.minutes}m</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="px-3 py-1 rounded-lg border" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={`px-3 py-1 rounded-lg bg-purple-600 text-white disabled:opacity-60 ${!canSplit ? "opacity-60 cursor-not-allowed" : ""}`}
              disabled={submitting || !canSplit}
              title={!canSplit ? "Only one segment — nothing to split" : "Split event"}
            >
              {submitting ? "Splitting…" : canSplit ? "Split" : "No Split (1 segment)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
