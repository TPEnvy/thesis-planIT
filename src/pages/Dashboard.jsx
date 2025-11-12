// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_URL = "http://localhost:5000";
const TZ = "Asia/Manila";

/* ------------------ Date helpers ------------------ */
const startOfWeekMon = (d) => {
  const dj = dayjs(d).tz(TZ).startOf("day");
  const dow = dj.day() === 0 ? 7 : dj.day(); // Mon=1..Sun=7
  return dj.subtract(dow - 1, "day").startOf("day"); // Monday 00:00
};

const range7 = (startDj) => Array.from({ length: 7 }, (_, i) => startDj.add(i, "day"));
const fmtDow = (d) => d.format("ddd");           // Mon
const fmtShort = (d) => d.format("MMM D");       // Sep 10
const fmtFull = (d) => d.format("YYYY-MM-DD");   // YYYY-MM-DD (stable key)
const weekTitle = (startDj) => {
  const end = startDj.add(6, "day");
  const sameMonth = startDj.month() === end.month();
  const sameYear = startDj.year() === end.year();
  if (sameYear && sameMonth) return `${startDj.format("MMM D")} – ${end.format("D, YYYY")}`;
  if (sameYear) return `${startDj.format("MMM D")} – ${end.format("MMM D, YYYY")}`;
  return `${startDj.format("MMM D, YYYY")} – ${end.format("MMM D, YYYY")}`;
};

export default function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);

  // Earliest navigation bound (based on account createdAt if available)
  const [firstWeekStart, setFirstWeekStart] = useState(null);

  /* ------------------ Load user, account date & events ------------------ */
  useEffect(() => {
    const raw = localStorage.getItem("user");
    if (!raw) {
      navigate("/login");
      return;
    }
    const u = JSON.parse(raw);
    setUser(u);

    let accountCreatedAt = null;

    (async () => {
      try {
        // Try to fetch createdAt (server needs timestamps on User + GET /users/:id)
        try {
          const ures = await fetch(`${API_URL}/users/${u.id}`);
          if (ures.ok) {
            const ujson = await ures.json();
            if (ujson?.createdAt) accountCreatedAt = ujson.createdAt;
          }
        } catch {
          /* ignore, fallback to events */
        }

        // Fetch events (owned + shared list like Schedule.jsx)
        const res = await fetch(`${API_URL}/events/${u.id}`);
        const data = await res.json();
        const safeEvents = Array.isArray(data) ? data : [];
        setEvents(safeEvents);

        // Determine earliest week bound
        if (accountCreatedAt) {
          setFirstWeekStart(startOfWeekMon(accountCreatedAt));
        } else {
          const ownedStarts = safeEvents
            .filter((e) => String(e.userId) === String(u.id))
            .map((e) => dayjs(e.start));
          if (ownedStarts.length) {
            const minStart = ownedStarts.reduce((a, b) => (a.isBefore(b) ? a : b));
            setFirstWeekStart(startOfWeekMon(minStart));
          } else {
            setFirstWeekStart(startOfWeekMon(dayjs()));
          }
        }
      } catch (e) {
        console.error("Failed to load dashboard data:", e);
        setFirstWeekStart(startOfWeekMon(dayjs())); // safe fallback
      }
    })();
  }, [navigate]);

  /* ------------------ Current viewed week ------------------ */
  const viewedWeekStart = useMemo(
    () => startOfWeekMon(dayjs().tz(TZ).add(weekOffset, "week")),
    [weekOffset]
  );
  const viewedWeekDays = useMemo(() => range7(viewedWeekStart), [viewedWeekStart]);

  /* ------------------ Weekly bars (status = productivity) ------------------ */
  const weeklyData = useMemo(() => {
    const rows = viewedWeekDays.map((d) => ({
      label: `${fmtDow(d)} (${fmtShort(d)})`,
      key: fmtFull(d),
      completed: 0,
      missed: 0,
    }));

    const start = viewedWeekStart.startOf("day");
    const end = start.add(7, "day");
    const nowPH = dayjs().tz(TZ);

    const baseId = (v = "") => {
      const s = String(v || "");
      return s.includes("-") ? s.split("-")[0] : s;
    };

    // Group by owner (parent id for children; own id for standalone)
    const byOwner = new Map();
    for (const ev of events || []) {
      if (!ev || ev.isShared) continue;
      const ownerId = ev.segmentOf ? baseId(String(ev.segmentOf)) : baseId(String(ev._id));
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(ev);
    }

    const addToRow = (date, kind /* "completed" | "missed" */) => {
      const key = fmtFull(dayjs(date).tz(TZ));
      const row = rows.find((r) => r.key === key);
      if (row) {
        if (kind === "completed") row.completed += 1;
        else if (kind === "missed") row.missed += 1;
      }
    };

    for (const [ownerId, arr] of byOwner.entries()) {
      const children = arr.filter((e) => e.segmentOf && baseId(String(e.segmentOf)) === ownerId);
      const parent = arr.find((e) => !e.segmentOf && baseId(String(e._id)) === ownerId);

      if (children.length > 0) {
        // Segmented → roll up as ONE on the parent end (or latest child end)
        const parentEnd = parent ? parent.end : null;
        const latestChildEnd = children.reduce(
          (acc, c) => (acc ? (dayjs(c.end).isAfter(acc) ? c.end : acc) : c.end),
          null
        );
        const anchorEnd = parentEnd || latestChildEnd;
        const anchorEndDj = dayjs(anchorEnd);

        // In viewed week?  start <= anchorEnd < end
        const inWeek = !anchorEndDj.isBefore(start) && anchorEndDj.isBefore(end);
        if (!inWeek) continue;

        const total = children.length;
        const completed = children.filter((c) => c.status === "completed").length;
        const missed = children.filter((c) => c.status === "missed").length;
        const anyFinal = completed > 0 || missed > 0;
        const allPending = completed === 0 && missed === 0;

        if (completed === total) {
          addToRow(anchorEnd, "completed");
        } else if (missed > 0 || (anyFinal && completed !== total)) {
          addToRow(anchorEnd, "missed");
        } else if (allPending && nowPH.isAfter(anchorEndDj.tz(TZ))) {
          addToRow(anchorEnd, "missed");
        }
        // future & pending → no count yet
      } else {
        // Standalone → one count on its end day
        const e = arr[0];
        const endDj = dayjs(e.end);
        const inWeek = !endDj.isBefore(start) && endDj.isBefore(end);
        if (!inWeek) continue;

        if (e.status === "completed") addToRow(e.end, "completed");
        else if (e.status === "missed") addToRow(e.end, "missed");
        else if (nowPH.isAfter(endDj.tz(TZ))) addToRow(e.end, "missed"); // overdue & pending
      }
    }

    return rows;
  }, [events, viewedWeekDays, viewedWeekStart]);

  /* ------------------ Summary ------------------ */
  const summary = useMemo(() => {
    const completed = weeklyData.reduce((acc, r) => acc + r.completed, 0);
    const missed = weeklyData.reduce((acc, r) => acc + r.missed, 0);
    const isGood = completed >= missed;
    const msg = isGood
      ? "Good week 🎉 You’re on track!"
      : "Unpleasant week 😞 Try to improve next week.";
    return { completed, missed, msg, isGood };
  }, [weeklyData]);

  /* ------------------ Navigation bounds ------------------ */
  const thisWeekStart = useMemo(() => startOfWeekMon(dayjs()), []);
  const canGoOlder = useMemo(() => {
    if (!firstWeekStart) return true;
    const prevWeekStart = viewedWeekStart.add(-1, "week");
    return !prevWeekStart.isBefore(firstWeekStart, "day");
  }, [viewedWeekStart, firstWeekStart]);

  // ⛔️ Prevent navigating into the future:
  const canGoNewer = useMemo(() => {
    return viewedWeekStart.isBefore(thisWeekStart, "day");
  }, [viewedWeekStart, thisWeekStart]);

  const goPrev = useCallback(() => {
    if (canGoOlder) setWeekOffset((w) => w - 1);
  }, [canGoOlder]);

  const goNext = useCallback(() => {
    if (canGoNewer) setWeekOffset((w) => w + 1);
  }, [canGoNewer]);

  const goThisWeek = useCallback(() => setWeekOffset(0), []);

  /* ------------------ Upcoming (next 7 days) ------------------ */
  const upcoming7 = useMemo(() => {
    if (!user) return [];
    const now = dayjs().tz(TZ);
    const horizon = now.add(7, "day");
    const owned = (events || []).filter((e) => String(e.userId) === String(user.id));
    return owned
      .filter((e) => dayjs(e.start).isBefore(horizon) && dayjs(e.end).isAfter(now))
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 8);
  }, [events, user]);

  /* ------------------ UI ------------------ */
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
      <Navbar />

      <main className="flex-grow px-4 sm:px-6 py-6">
        <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart Card */}
          <section className="lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6">
              {/* Header & Controls */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-green-800">Weekly Productivity</h2>
                  <p className="text-sm text-gray-600">{`Week of ${weekTitle(viewedWeekStart)}`}</p>
                  {firstWeekStart && (
                    <p className="text-xs text-gray-400">
                      Tracking since week of {weekTitle(firstWeekStart)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={goPrev}
                    disabled={!canGoOlder}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      canGoOlder
                        ? "bg-gray-100 hover:bg-gray-200 text-gray-800"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    ← Older
                  </button>
                  <button
                    onClick={goThisWeek}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700"
                  >
                    This Week
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!canGoNewer}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      canGoNewer
                        ? "bg-gray-100 hover:bg-gray-200 text-gray-800"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Newer →
                  </button>
                </div>
              </div>

              {/* Chart */}
              <div className="w-full h-80">
                <ResponsiveContainer>
                  <BarChart data={weeklyData} margin={{ top: 8, right: 12, left: 12, bottom: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      minTickGap={0}
                      tickLine={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" name="Completed ✅" fill="#16a34a" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="missed" name="Missed ❌" fill="#dc2626" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Summary */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                  <div className="text-sm text-green-700">Completed</div>
                  <div className="text-2xl font-bold text-green-800">{summary.completed}</div>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                  <div className="text-sm text-red-700">Missed</div>
                  <div className="text-2xl font-bold text-red-800">{summary.missed}</div>
                </div>
                <div className="rounded-xl border border-gray-300 bg-gray-50 p-4 text-center">
                  <div className="text-sm text-gray-700">This Week</div>
                  <div
                    className={`text-sm font-semibold mt-1 ${
                      summary.isGood ? "text-green-800" : "text-red-700"
                    }`}
                  >
                    {summary.msg}
                  </div>
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => navigate("/schedule")}
                className="mt-6 w-full bg-green-800 text-white py-3 rounded-xl hover:bg-green-900 transition"
              >
                + Add New Task
              </button>
            </div>
          </section>

          {/* Upcoming (next 7 days) */}
          <aside className="lg:col-span-4">
            <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-green-900 mb-3">Upcoming (Next 7 Days)</h3>
              {upcoming7.length === 0 ? (
                <p className="text-sm text-gray-500">No upcoming events in the next 7 days.</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming7.map((ev) => (
                    <li
                      key={String(ev._id)}
                      className="p-3 rounded-xl border bg-white hover:shadow-sm transition"
                    >
                      <p className="font-medium text-gray-800">{ev.title}</p>
                      <p className="text-xs text-gray-600">
                        {dayjs(ev.start).tz(TZ).format("ddd, MMM D · h:mm A")} –{" "}
                        {dayjs(ev.end).tz(TZ).format("h:mm A")}
                      </p>
                      <div className="mt-1 flex gap-2">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            ev.urgency === "high"
                              ? "border-red-200 text-red-600 bg-red-50"
                              : "border-orange-200 text-orange-600 bg-orange-50"
                          }`}
                        >
                          {ev.urgency === "high" ? "Urgent" : "Somewhat Urgent"}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            ev.importance === "high"
                              ? "border-blue-200 text-blue-700 bg-blue-50"
                              : "border-gray-200 text-gray-600 bg-gray-50"
                          }`}
                        >
                          {ev.importance === "high" ? "Important" : "Somewhat Important"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}
