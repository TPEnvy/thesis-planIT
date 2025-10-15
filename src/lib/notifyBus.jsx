// src/lib/notifyBus.js
export const NOTIFY_EVENT = "planit:notify";

export function emitNavNotification({ title, message, href } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTIFY_EVENT, {
      detail: {
        title: title || "Notification",
        message: message || "",
        href: href || null,
      },
    })
  );
}

export function onNavNotification(handler) {
  if (typeof window === "undefined") return () => {};
  const fn = (e) => handler(e.detail || {});
  window.addEventListener(NOTIFY_EVENT, fn);
  return () => window.removeEventListener(NOTIFY_EVENT, fn);
}
