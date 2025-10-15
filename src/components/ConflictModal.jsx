// src/components/ConflictModal.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { FiAlertTriangle, FiX, FiCheckCircle, FiLayers, FiTrash2 } from "react-icons/fi";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
const TZ = "Asia/Manila";
const NAV_EVENT = "planit:notify";

const fmt = (d) => dayjs(d).tz(TZ);
function formatRange(start, end) {
  try {
    const s = fmt(start);
    const e = fmt(end);
    if (!s.isValid() || !e.isValid()) return "Invalid date";
    const sFmt = s.format("MMM D, YYYY h:mm A");
    const eSameDay = s.isSame(e, "day");
    const eFmt = eSameDay ? e.format("h:mm A") : e.format("MMM D, YYYY h:mm A");
    return `${sFmt} – ${eFmt}`;
  } catch {
    return "Invalid date";
  }
}

export default function ConflictModal({ isOpen, conflict, onClose }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);

  const details = useMemo(() => {
    const inc = conflict?.incoming || null;
    const ex = conflict?.existing || null;
    const reqId = conflict?.requestId || null;
    const from = inc?.userName || "Someone";
    const incomingRange = inc ? formatRange(inc.start, inc.end) : "";
    const existingRange = ex ? formatRange(ex.start, ex.end) : "";
    return { inc, ex, reqId, from, incomingRange, existingRange };
  }, [conflict]);

  // Scroll lock + ESC + focus trap (always called, logic gated by isOpen)
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e) => e.key === "Escape" && !submitting && onClose?.();
    document.addEventListener("keydown", onKey);

    const root = dialogRef.current;
    const selector =
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const getNodes = () =>
      Array.from(root?.querySelectorAll(selector) || []).filter(
        (n) => !n.hasAttribute("disabled")
      );
    const onKeydown = (e) => {
      if (e.key !== "Tab") return;
      const nodes = getNodes();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    root?.addEventListener("keydown", onKeydown);

    return () => {
      document.removeEventListener("keydown", onKey);
      root?.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = prev;
    };
  }, [isOpen, submitting, onClose]);

  const respond = useCallback(
    async (choice) => {
      if (!details.reqId) return;
      setSubmitting(true);
      setError("");
      try {
        const token = localStorage.getItem("token");
        const headers = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const res = await fetch(`${API_BASE}/share-requests/${details.reqId}/respond`, {
          method: "PATCH",
          headers,
          credentials: "include",
          body: JSON.stringify({ choice }), // "keep" | "replace" | "decline"
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to respond");

        // 🔔 In-app notification
        const msg =
          choice === "keep"
            ? "Kept both events"
            : choice === "replace"
            ? "Replaced your event with incoming"
            : "Declined the incoming event";
        window.dispatchEvent(
          new CustomEvent(NAV_EVENT, {
            detail: { title: "Share request handled", message: msg, href: "/schedule" },
          })
        );

        onClose?.(); // Schedule.jsx will refresh
      } catch (err) {
        setError(err.message || "Something went wrong");
      } finally {
        setSubmitting(false);
      }
    },
    [details.reqId, onClose]
  );

  // Early return AFTER hooks
  if (!isOpen || !conflict) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        onClick={() => !submitting && onClose?.()}
        className="absolute inset-0 bg-black/40"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-2xl mx-4 rounded-2xl bg-white shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-amber-50">
          <div className="flex items-center gap-2">
            <FiAlertTriangle className="text-amber-600 text-xl" />
            <h3 id="conflict-modal-title" className="text-lg font-semibold text-amber-800">
              Incoming event conflicts with your schedule
            </h3>
          </div>
          <button
            onClick={() => !submitting && onClose?.()}
            className="p-2 rounded-lg hover:bg-amber-100 text-amber-800"
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Incoming */}
          <div className="rounded-xl border bg-amber-50/60 border-amber-200 p-4">
            <div className="text-xs uppercase tracking-wide text-amber-700 mb-1">
              Incoming event
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <p className="font-semibold text-amber-900">
                {details.inc?.title || "Untitled"}
              </p>
              <span className="text-xs text-amber-800">From {details.from}</span>
            </div>
            <p className="text-sm text-amber-800 mt-1">{details.incomingRange}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  details.inc?.urgency === "high"
                    ? "border-red-200 text-red-700 bg-red-50"
                    : "border-orange-200 text-orange-700 bg-orange-50"
                }`}
              >
                {details.inc?.urgency === "high" ? "Urgent" : "Somewhat Urgent"}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  details.inc?.importance === "high"
                    ? "border-blue-200 text-blue-700 bg-blue-50"
                    : "border-gray-200 text-gray-600 bg-gray-50"
                }`}
              >
                {details.inc?.importance === "high" ? "Important" : "Somewhat Important"}
              </span>
              {details.inc?.difficulty && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-700 bg-purple-50">
                  Difficulty: {String(details.inc.difficulty).toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Existing */}
          <div className="rounded-xl border bg-gray-50 border-gray-200 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-600 mb-1">
              Your existing event (conflict)
            </div>
            <p className="font-semibold text-gray-800">
              {details.ex?.title || "Untitled"}
            </p>
            <p className="text-sm text-gray-600 mt-1">{details.existingRange}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  details.ex?.urgency === "high"
                    ? "border-red-200 text-red-700 bg-red-50"
                    : "border-orange-200 text-orange-700 bg-orange-50"
                }`}
              >
                {details.ex?.urgency === "high" ? "Urgent" : "Somewhat Urgent"}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  details.ex?.importance === "high"
                    ? "border-blue-200 text-blue-700 bg-blue-50"
                    : "border-gray-200 text-gray-600 bg-gray-50"
                }`}
              >
                {details.ex?.importance === "high" ? "Important" : "Somewhat Important"}
              </span>
              {details.ex?.difficulty && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-700 bg-purple-50">
                  Difficulty: {String(details.ex.difficulty).toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              disabled={submitting}
              onClick={() => respond("decline")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-60"
              title="Decline this shared event"
            >
              <FiTrash2 /> Decline
            </button>

            <button
              disabled={submitting}
              onClick={() => respond("keep")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
              title="Keep both (add incoming alongside yours)"
            >
              <FiCheckCircle /> Keep both
            </button>

            <button
              disabled={submitting}
              onClick={() => respond("replace")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              title="Replace your conflicting event with incoming"
            >
              <FiLayers /> Replace mine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
