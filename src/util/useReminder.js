// src/util/useReminder.js
import { useRef, useEffect, useCallback } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Manila";
const NAV_EVENT = "planit:notify";
const BUFFER_WINDOW_MS = 1200; // group notifications that fire together

// --- helpers (no hooks) ---
function isValidDayjs(dj) {
  return dj && typeof dj.isValid === "function" && dj.isValid();
}
// normalize ids: strips -YYYY and virt_ prefix to line up with Schedule.jsx's baseId()
function normId(v = "") {
  let s = String(v || "");
  if (s.startsWith("virt_")) s = s.slice(5);
  if (s.includes("-")) s = s.split("-")[0];
  return s;
}

export default function useReminders() {
  // eventId -> [timeoutIds]
  const scheduledTimeoutsRef = useRef({});
  // eventId -> { fiveBefore?: true, start?: true, end?: true }
  const notifiedRef = useRef({});

  // buffer for batching UI notifications
  const bufferRef = useRef([]); // array of { event, message }
  const bufferTimerRef = useRef(null);

  const ensurePermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    } catch {
      return false;
    }
  }, []);

  const dispatchNavEvent = useCallback((detail) => {
    try {
      // DEBUG
      // console.log("[useReminder] dispatch", NAV_EVENT, detail);
      window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail }));
    } catch {
      /* ignore */
    }
  }, []);

  const flushBuffer = useCallback(() => {
    const items = bufferRef.current.splice(0, bufferRef.current.length);
    bufferTimerRef.current = null;
    if (!items.length) return;

    if (items.length === 1) {
      const { event, message } = items[0];

      // fallback alert (eslint no-alert? disable if needed)
      try {
        alert(`${event.title}: ${message}`);
      } catch {
        /* ignore */
      }

      // Web Notification
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("⏰ Schedule Reminder", {
            body: `${event.title}: ${message}`,
            icon: "/favicon.ico",
          });
        } catch {
          /* ignore */
        }
      }

      // Navbar bell
      dispatchNavEvent({
        title: "Schedule Reminder",
        message: `${event.title}: ${message}`,
        href: "/schedule",
      });
      return;
    }

    // combined
    const titles = items.map((i) => i.event.title).join(", ");
    const body = `${items.length} events: ${titles}`;

    try {
      alert(`⏰ Reminders\n${body}`);
    } catch {
      /* ignore */
    }

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("⏰ Multiple reminders", { body, icon: "/favicon.ico" });
      } catch {
        /* ignore */
      }
    }

    dispatchNavEvent({
      title: "Multiple reminders",
      message: body,
      href: "/schedule",
    });
  }, [dispatchNavEvent]);

  const queueNotification = useCallback(
    (event, message) => {
      bufferRef.current.push({ event, message });
      if (!bufferTimerRef.current) {
        bufferTimerRef.current = setTimeout(flushBuffer, BUFFER_WINDOW_MS);
      }
    },
    [flushBuffer]
  );

  const triggerReminder = useCallback(
    (event, message, key) => {
      if (!event || !event._id) return;
      const id = normId(event._id);

      if (notifiedRef.current[id]?.[key]) return; // de-dupe per event/key
      notifiedRef.current[id] = { ...(notifiedRef.current[id] || {}), [key]: true };

      // DEBUG
      // console.log("[useReminder] trigger", { id, key, message });

      queueNotification(event, message);
    },
    [queueNotification]
  );

  const scheduleReminders = useCallback(
    (event) => {
      if (!event || !event._id) return;
      if (event.isVirtual) return;
      if (event.status === "completed" || event.status === "missed") return;

      const id = normId(event._id);
      if (scheduledTimeoutsRef.current[id]) return; // already scheduled

      const now = dayjs().tz(TZ);
      const start = dayjs(event.start).tz(TZ);
      const end = dayjs(event.end).tz(TZ);

      if (!isValidDayjs(start) || !isValidDayjs(end) || !end.isAfter(start)) {
        // console.warn("[useReminder] skipped invalid event times", { event });
        return;
      }
      if (end.isBefore(now)) {
        // already finished in the past
        return;
      }

      scheduledTimeoutsRef.current[id] = [];

      // 5 minutes before start
      const fiveBefore = start.subtract(5, "minute");
      if (fiveBefore.isAfter(now)) {
        const t = setTimeout(() => {
          triggerReminder(event, "Upcoming event in 5 minutes!", "fiveBefore");
        }, Math.max(0, fiveBefore.diff(now)));
        scheduledTimeoutsRef.current[id].push(t);
      }

      // start
      if (start.isAfter(now)) {
        const tStart = setTimeout(() => {
          triggerReminder(event, "Event has started!", "start");
        }, Math.max(0, start.diff(now)));
        scheduledTimeoutsRef.current[id].push(tStart);
      }

      // end (+1 min)
      const endNotifyTime = end.add(1, "minute");
      if (endNotifyTime.isAfter(now)) {
        const tEnd = setTimeout(() => {
          triggerReminder(event, "Event ended. Mark it ✔ Completed or ✖ Missed.", "end");
        }, Math.max(0, endNotifyTime.diff(now)));
        scheduledTimeoutsRef.current[id].push(tEnd);
      }
    },
    [triggerReminder]
  );

  const cancelRemindersFor = useCallback((eventId) => {
    const id = normId(eventId);
    const arr = scheduledTimeoutsRef.current[id];
    if (Array.isArray(arr)) {
      arr.forEach((t) => {
        try {
          clearTimeout(t);
        } catch {
          /* ignore */
        }
      });
    }
    delete scheduledTimeoutsRef.current[id];
    delete notifiedRef.current[id];
  }, []);

  const cancelAllReminders = useCallback(() => {
    Object.values(scheduledTimeoutsRef.current).forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((t) => {
          try {
            clearTimeout(t);
          } catch {
            /* ignore */
          }
        });
      }
    });
    scheduledTimeoutsRef.current = {};
    notifiedRef.current = {};

    if (bufferTimerRef.current) {
      try {
        clearTimeout(bufferTimerRef.current);
      } catch {
        /* ignore */
      }
      bufferTimerRef.current = null;
    }
    bufferRef.current = [];
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => cancelAllReminders();
  }, [cancelAllReminders]);

  return { scheduleReminders, cancelRemindersFor, cancelAllReminders, ensurePermission };
}
