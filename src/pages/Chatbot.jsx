// src/pages/Chatbot.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import {
  FiSend,
  FiAlertTriangle,
  FiClock,
  FiChevronDown,
  FiTrash2,
  FiPlus,
  FiEdit2,
  FiPieChart,
  FiCalendar,
  FiScissors
} from "react-icons/fi";

const API_URL = "http://localhost:5000"; // keep in-sync with your server
const TZ = "Asia/Manila";

function Chip({ children, onClick, icon: Icon, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 text-gray-700 border border-gray-200 hover:bg-white hover:shadow transition"
    >
      {Icon && <Icon className="text-gray-500" />}
      <span className="text-xs font-medium">{children}</span>
    </button>
  );
}

function Bubble({ role, text, meta }) {
  const isUser = role === "user";
  return (
    <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2 shadow",
          isUser
            ? "bg-green-600 text-white rounded-br-sm"
            : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        {meta && (
          <div className={`mt-1 text-[11px] flex items-center gap-1 ${isUser ? "text-white/80" : "text-gray-500"}`}>
            <FiClock />
            <span>{meta}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chatbot() {
  const [authUser] = useState(() => {
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [messages, setMessages] = useState(() => [
    {
      role: "assistant",
      text:
        "Hi! I can add/edit/delete/split tasks, tell today's schedule, or rate your week. Try: \n• add study react november 12 2-4pm\n• reschedule study react to nov 13 3-5pm\n• split study react\n• what's my schedule today\n• is this a good week?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    // auto-scroll to newest
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const userId = authUser?.id || authUser?._id || "";

  const disabled = useMemo(() => !input.trim() || !userId || sending, [input, userId, sending]);

  async function send(text) {
    if (!userId) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "You’re signed out. Please log in to use the chatbot." },
      ]);
      return;
    }

    const payload = { userId, text };
    setSending(true);
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Chat failed");

      let reply = data?.message || "(no message)";
      if (data?.intent === "ADD_TASK" && data?.event) {
        reply += `\n\n➕ Created: ${data.event.title}`;
      }
      if (data?.intent === "EDIT_TASK" && data?.event) {
        reply += `\n\n✏️ Updated: ${data.event.title}`;
      }
      if (data?.intent === "DELETE_TASK") {
        reply += `\n\n🗑️ Removed.`;
      }
      if (data?.intent === "SPLIT_TASK" && data?.segments?.length) {
        reply += `\n\n✂️ Segments: ${data.segments.length}`;
      }

      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `\n⚠️ ${e?.message || "Something went wrong"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const quickPrompts = [
    { label: "Add task", icon: FiPlus, text: "add a task study react november 12 2-4pm" },
    { label: "Reschedule", icon: FiEdit2, text: "reschedule study react to nov 13 3-5pm" },
    { label: "Delete", icon: FiTrash2, text: "delete study react" },
    { label: "Split", icon: FiScissors, text: "split study react" },
  ];

  function handleSubmit(e) {
    e.preventDefault();
    if (disabled) return;
    send(input.trim());
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
      <Navbar />

      <main className="flex-1 px-3 sm:px-6 py-4">
        <div className="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Sidebar (hidden on small) */}
          <aside className="hidden lg:block lg:col-span-4">
            <div className="sticky top-4 space-y-4">
              <div className="bg-white rounded-2xl shadow-xl border border-green-100 p-5">
                <h2 className="text-lg font-bold text-green-900">Chatbot tips</h2>
                <ul className="mt-3 text-sm text-gray-600 list-disc pl-5 space-y-2">
                  <li>Use natural time: “tomorrow 3-5pm”, “next Friday at 8am”.</li>
                  <li>Add attributes: say <b>urgent</b>, <b>important</b>, or <b>easy/hard</b>.</li>
                  <li>Ask: “what’s my schedule today” or “is this a good week?”.</li>
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip icon={FiCalendar} onClick={() => send("what's my schedule today")}>
                    Today’s schedule
                  </Chip>
                  <Chip icon={FiPieChart} onClick={() => send("weekly productivity")}>
                    Weekly productivity
                  </Chip>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-xl border border-green-100 p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Quick actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Chip icon={FiPlus} onClick={() => send("add a task study react november 12 2-4pm")}>Add task</Chip>
                  <Chip icon={FiEdit2} onClick={() => send("reschedule study react to nov 13 3-5pm")}>Reschedule</Chip>
                  <Chip icon={FiTrash2} onClick={() => send("delete study react")}>Delete</Chip>
                  <Chip icon={FiClock} onClick={() => send("split study react")}>Split</Chip>
                </div>
              </div>
            </div>
          </aside>

          {/* Chat panel */}
          <section className="lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-xl border border-green-100 flex flex-col h-[75vh] sm:h-[78vh]">
              {/* Header */}
              <div className="px-4 sm:px-5 py-3 border-b flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-green-900">PlanIT Assistant</h1>
                  <p className="text-xs text-gray-500">PH time • {new Date().toLocaleString("en-US", { timeZone: TZ })}</p>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <Chip icon={FiCalendar} onClick={() => send("what's my schedule today")}>
                    Today
                  </Chip>
                  <Chip icon={FiPieChart} onClick={() => send("weekly productivity")}>
                    This week
                  </Chip>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollerRef} className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 bg-gradient-to-b from-white to-green-50/30">
                {messages.map((m, i) => (
                  <Bubble key={i} role={m.role} text={m.text} />
                ))}
              </div>

              {/* Composer (mobile-friendly) */}
              <form onSubmit={handleSubmit} className="p-3 sm:p-4 border-t">
                <div className="flex items-end gap-2">
                  <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-green-600">
                    <textarea
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={userId ? "Type a message… e.g., add study react tomorrow 2-4pm" : "Log in to use the assistant"}
                      className="w-full bg-transparent outline-none resize-none text-sm py-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!disabled) handleSubmit(e);
                        }
                      }}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip icon={FiPlus} onClick={() => setInput("add a task study react november 12 2-4pm")}>Add</Chip>
                      <Chip icon={FiEdit2} onClick={() => setInput("reschedule study react to nov 13 3-5pm")}>Resched</Chip>
                      <Chip icon={FiTrash2} onClick={() => setInput("delete study react")}>Delete</Chip>
                      <Chip icon={FiClock} onClick={() => setInput("split study react")}>Split</Chip>
                    </div>
                  </div>

                  <button
                    disabled={disabled}
                    className={`h-11 w-11 rounded-full flex items-center justify-center text-white transition ${
                      disabled ? "bg-gray-300 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
                    }`}
                    aria-label="Send"
                    title="Send"
                  >
                    <FiSend />
                  </button>
                </div>

                {/* Mobile quick chips under composer */}
                <div className="mt-3 flex sm:hidden flex-wrap gap-2">
                  <Chip icon={FiCalendar} onClick={() => send("what's my schedule today")}>Today</Chip>
                  <Chip icon={FiPieChart} onClick={() => send("weekly productivity")}>This week</Chip>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
