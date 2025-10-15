// src/components/ShareModal.jsx
import React, { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
const TZ = "Asia/Manila";
const NAV_EVENT = "planit:notify";

// super-light email check
const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

export default function ShareModal({
  isOpen,
  onClose,
  eventId,     // real ObjectId (Schedule.jsx strips any -YYYY suffix already)
  onShared,    // optional: (incomingEvent) => void
  senderId,    // optional (display/log only)
  senderEmail, // optional (UI + self-share guard)
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [serverMsg, setServerMsg] = useState("");
  const [conflict, setConflict] = useState(null); // { title, start, end } or null

  const dialogRef = useRef(null);
  const emailRef = useRef(null);

  // Scroll lock + ESC close while open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  // Focus first input on open
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => emailRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  // Reset form when opening/closing
  useEffect(() => {
    if (!isOpen) return;
    setRecipientEmail("");
    setNote("");
    setErr("");
    setServerMsg("");
    setConflict(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmedEmail = recipientEmail.trim().toLowerCase();
  const emailOk = isEmail(trimmedEmail);
  const hasEventId = Boolean(eventId);
  const isSelf = senderEmail && trimmedEmail === String(senderEmail).toLowerCase();
  const canSubmit = hasEventId && emailOk && !isSelf && !submitting;

  const fmt = (d) => dayjs(d).tz(TZ).format("MMM D, YYYY h:mm A");

  const handleClose = () => onClose?.();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErr("");
    setServerMsg("");
    setConflict(null);

    try {
      const token = localStorage.getItem("token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const res = await fetch(`${API_BASE}/events/${eventId}/share`, {
        method: "POST",
        headers,
        credentials: "include", // keep if you use cookie sessions; harmless otherwise
        body: JSON.stringify({
          recipientEmail: trimmedEmail,
          note: note.slice(0, 500),
          senderId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Share failed (HTTP ${res.status})`);
      }

      setServerMsg(data?.message || "Shared successfully.");

      // 🔔 in-app bell notification
      window.dispatchEvent(
        new CustomEvent(NAV_EVENT, {
          detail: { title: "Event shared", message: `Sent to ${trimmedEmail}`, href: "/schedule" },
        })
      );

      if (data?.conflict) {
        // Keep modal open to show that the recipient has a conflict
        setConflict(data.conflict);
      } else {
        handleClose();
      }

      if (typeof onShared === "function" && data?.incoming) {
        onShared(data.incoming);
      }
    } catch (e2) {
      console.error("Share error:", e2);
      setErr(e2?.message || "Failed to share");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="share-modal-title" className="text-lg font-semibold mb-1">
          Share Event
        </h2>

        {(senderEmail || senderId) && (
          <p className="text-xs text-gray-500 mb-2">
            {senderEmail && (
              <>
                From: <span className="font-medium">{senderEmail}</span>
              </>
            )}
            {senderEmail && senderId ? " · " : null}
            {senderId && (
              <>
                UserId: <span className="font-mono">{senderId}</span>
              </>
            )}
          </p>
        )}

        {!hasEventId && (
          <p className="text-sm text-red-600 mb-2">
            Missing event id. Please close and open Share again.
          </p>
        )}

        <p className="text-sm text-gray-600 mb-4">
          This creates a <b>share request</b>. The recipient can keep both, replace, or decline.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm" htmlFor="recipient-email">
              Recipient Email
            </label>
            <input
              id="recipient-email"
              type="email"
              inputMode="email"
              className="w-full border rounded-lg p-2 mt-1"
              placeholder="friend@example.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              ref={emailRef}
              required
            />
            {recipientEmail.length > 0 && !emailOk && (
              <p className="text-xs text-red-600 mt-1">Please enter a valid email.</p>
            )}
            {isSelf && (
              <p className="text-xs text-red-600 mt-1">You can’t share an event with yourself.</p>
            )}
          </div>

          <div>
            <label className="text-sm" htmlFor="share-note">
              Note (optional)
            </label>
            <textarea
              id="share-note"
              className="w-full border rounded-lg p-2 mt-1"
              placeholder="Add a short note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <div className="text-[11px] text-gray-400 text-right">{note.length}/500</div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
          {serverMsg && <p className="text-sm text-green-700">{serverMsg}</p>}

          {conflict ? (
            <div className="mt-2 rounded-lg p-2 bg-yellow-50">
              <p className="text-sm font-semibold text-yellow-800">
                Heads up: recipient has a conflicting event.
              </p>
              <p className="text-xs text-yellow-800 mt-1">
                They’ll resolve it (keep both or replace) on their side.
              </p>
              <div className="text-xs text-gray-700 mt-2">
                <div className="font-medium">{conflict.title}</div>
                <div>
                  {fmt(conflict.start)} – {dayjs(conflict.end).tz(TZ).format("h:mm A")}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg border"
                  onClick={handleClose}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1 rounded-lg border"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-60"
                disabled={!canSubmit}
              >
                {submitting ? "Sending…" : "Send Request"}
              </button>
            </div>
          )}
        </form>

        <p className="mt-3 text-[11px] text-gray-400">
          The backend should accept the real ObjectId (no virtual suffix). Your page already strips any <code>-YYYY</code> suffix.
        </p>
      </div>
    </div>
  );
}
