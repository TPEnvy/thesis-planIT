// src/util/useReminder.js
import { useRef, useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Manila";
const NAV_EVENT = "planit:notify";
const BUFFER_WINDOW_MS = 1200;

function isValidDayjs(dj) {
  return dj && typeof dj.isValid === "function" && dj.isValid();
}
function normId(v = "") {
  let s = String(v || "");
  if (s.startsWith("virt_")) s = s.slice(5);
  if (s.includes("-")) s = s.split("-")[0];
  return s;
}

export default function useReminders() {
  const scheduledTimeoutsRef = useRef({});
  const notifiedRef = useRef({});

  const bufferRef = useRef([]);
  const bufferTimerRef = useRef(null);

  const ensurePermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast.error("Notifications not supported 🚫");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      toast.error("Notifications blocked in browser settings");
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") toast.success("Notifications Enabled 🔔");
    return perm === "granted";
  }, []);

  const dispatchNavEvent = useCallback((detail) => {
    try {
      window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail }));
    } catch {
      // console.error("dispatchNavEvent failed"); // optional
    }
  }, []);


  const flushBuffer = useCallback(() => {
    const items = bufferRef.current.splice(0);
    bufferTimerRef.current = null;
    if (!items.length) return;

    if (items.length === 1) {
      const { event, message } = items[0];

      toast(message, { icon: "⏰" });

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⏰ Schedule Reminder", {
          body: `${event.title}: ${message}`,
          icon: "/favicon.ico",
        });
      }

      dispatchNavEvent({
        title: "Schedule Reminder",
        message: `${event.title}: ${message}`,
        href: "/schedule",
      });
      return;
    }

    const titles = items.map((i) => i.event.title).join(", ");
    const body = `${items.length} events: ${titles}`;

    toast(`🔔 ${body}`);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⏰ Multiple reminders", {
        body,
        icon: "/favicon.ico",
      });
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
      const id = normId(event._id);
      if (notifiedRef.current[id]?.[key]) return;

      notifiedRef.current[id] = {
        ...(notifiedRef.current[id] || {}),
        [key]: true,
      };

      queueNotification(event, message);
    },
    [queueNotification]
  );

  const scheduleReminders = useCallback(
    (event) => {
      if (!event?._id) return;
      if (event.status === "completed" || event.status === "missed") return;

      const id = normId(event._id);
      if (scheduledTimeoutsRef.current[id]) return;

      const now = dayjs().tz(TZ);
      const start = dayjs(event.start).tz(TZ);
      const end = dayjs(event.end).tz(TZ);

      if (!isValidDayjs(start) || !isValidDayjs(end) || !end.isAfter(start)) return;
      if (end.isBefore(now)) return;

      scheduledTimeoutsRef.current[id] = [];

      const fiveBefore = start.subtract(5, "minute");
      if (fiveBefore.isAfter(now)) {
        scheduledTimeoutsRef.current[id].push(
          setTimeout(() => {
            triggerReminder(event, "Upcoming event in 5 minutes!", "fiveBefore");
          }, fiveBefore.diff(now))
        );
      }

      if (start.isAfter(now)) {
        scheduledTimeoutsRef.current[id].push(
          setTimeout(() => {
            triggerReminder(event, "Event has started!", "start");
          }, start.diff(now))
        );
      }

      const endNotifyTime = end.add(1, "minute");
      if (endNotifyTime.isAfter(now)) {
        scheduledTimeoutsRef.current[id].push(
          setTimeout(() => {
            triggerReminder(event, "Event ended. Mark ✔ or ✖", "end");
          }, endNotifyTime.diff(now))
        );
      }
    },
    [triggerReminder]
  );

  const cancelRemindersFor = useCallback((eventId) => {
    const id = normId(eventId);
    const timers = scheduledTimeoutsRef.current[id];
    timers?.forEach(clearTimeout);
    delete scheduledTimeoutsRef.current[id];
    delete notifiedRef.current[id];
  }, []);

  const cancelAllReminders = useCallback(() => {
    Object.values(scheduledTimeoutsRef.current).forEach((arr) =>
      arr?.forEach(clearTimeout)
    );
    scheduledTimeoutsRef.current = {};
    notifiedRef.current = {};

    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = null;
    bufferRef.current = [];
  }, []);

  useEffect(() => cancelAllReminders, [cancelAllReminders]);

  return { scheduleReminders, cancelRemindersFor, cancelAllReminders, ensurePermission };
}
