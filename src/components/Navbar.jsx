// src/components/Navbar.jsx
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaUserCircle } from "react-icons/fa";
import { FiMenu, FiX, FiBell } from "react-icons/fi";

const NAV_EVENT = "planit:notify";
const LS_KEY = "planit.notifications";

function loadNotifs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveNotifs(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

const Navbar = () => {
  const navigate = useNavigate();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => loadNotifs());

  // unread count
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const handleLogout = () => {
    localStorage.removeItem("user");
    navigate("/login");
  };

  // Listen to reminders coming from useReminder via CustomEvent
  useEffect(() => {
    const onNotify = (e) => {
      const { title, message, href } = (e && e.detail) || {};
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title || "Notification",
        message: message || "",
        href: href || "",
        createdAt: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => {
        const next = [item, ...prev].slice(0, 50); // cap to last 50
        saveNotifs(next);
        return next;
      });
      // Optionally auto-open the tray:
      // setIsNotifOpen(true);
    };

    window.addEventListener(NAV_EVENT, onNotify);
    return () => window.removeEventListener(NAV_EVENT, onNotify);
  }, []);

  // Mark all as read when opening the tray
  useEffect(() => {
    if (isNotifOpen && unreadCount > 0) {
      setNotifications((prev) => {
        const next = prev.map((n) => ({ ...n, read: true }));
        saveNotifs(next);
        return next;
      });
    }
  }, [isNotifOpen, unreadCount]);

  const clearAll = () => {
    setNotifications([]);
    saveNotifs([]);
  };

  const handleClickNotif = (n) => {
    // mark read
    setNotifications((prev) => {
      const next = prev.map((x) => (x.id === n.id ? { ...x, read: true } : x));
      saveNotifs(next);
      return next;
    });
    // navigate if href provided
    if (n.href) {
      navigate(n.href);
      setIsNotifOpen(false);
    }
  };

  // close dropdowns on route change (optional)
  // useEffect(() => {
  //   setIsNotifOpen(false);
  //   setIsUserDropdownOpen(false);
  //   setIsMenuOpen(false);
  // }, [location.pathname]);

  return (
    <header className="sticky top-0 z-50 bg-transparent backdrop-blur-md border-b border-white/10">
      <nav className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-16 text-green-800">
          {/* Brand */}
          <div className="flex-shrink-0 text-2xl font-extrabold tracking-wide text-green-800">
            <Link to="/dashboard" className="hover:text-green-600 transition">
              PlanIT
            </Link>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex space-x-6 items-center font-medium">
            <Link to="/dashboard" className="hover:text-green-600 transition">
              Home
            </Link>
            <Link to="/schedule" className="hover:text-green-600 transition">
              Schedule
            </Link>
            <Link to="/chatbot" className="hover:text-green-600 transition">
              Chat
            </Link>

            {/* Notification bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsNotifOpen((s) => !s);
                  setIsUserDropdownOpen(false);
                }}
                className="relative p-2 rounded-lg hover:text-green-600 focus:outline-none"
                aria-label="Notifications"
              >
                <FiBell className="w-6 h-6" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications dropdown */}
              {isNotifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg py-2 text-gray-800 border border-gray-100">
                  <div className="flex items-center justify-between px-4 py-2 border-b">
                    <div className="font-semibold text-sm">Notifications</div>
                    {notifications.length > 0 && (
                      <button
                        onClick={clearAll}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-gray-500">
                      No notifications yet.
                    </div>
                  ) : (
                    <ul className="max-h-80 overflow-auto">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                            !n.read ? "bg-green-50/50" : ""
                          }`}
                          onClick={() => handleClickNotif(n)}
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-1">
                              <FiBell className="w-4 h-4 text-green-700" />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-gray-800">
                                {n.title}
                              </div>
                              {n.message && (
                                <div className="text-xs text-gray-600 mt-0.5">
                                  {n.message}
                                </div>
                              )}
                              <div className="text-[10px] text-gray-400 mt-1">
                                {new Date(n.createdAt).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* User Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setIsUserDropdownOpen((s) => !s);
                  setIsNotifOpen(false);
                }}
                className="flex items-center focus:outline-none"
              >
                <FaUserCircle
                  size={28}
                  className="text-green-800 hover:text-green-600 transition"
                />
              </button>

              {isUserDropdownOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg shadow-lg py-2 text-gray-800">
                  <Link
                    to="/profile"
                    className="block px-4 py-2 hover:bg-gray-50 rounded-md transition"
                    onClick={() => setIsUserDropdownOpen(false)}
                  >
                    Profile
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-red-500 rounded-md transition"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center gap-2">
            {/* Mobile bell */}
            <button
              type="button"
              onClick={() => {
                setIsNotifOpen((s) => !s);
                setIsUserDropdownOpen(false);
              }}
              className="relative p-2 rounded-lg hover:bg-green-50 focus:outline-none"
              aria-label="Notifications"
            >
              <FiBell className="w-6 h-6" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setIsMenuOpen((s) => !s);
                setIsUserDropdownOpen(false);
                setIsNotifOpen(false);
              }}
              className="focus:outline-none"
            >
              {isMenuOpen ? <FiX size={28} /> : <FiMenu size={28} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Notifications dropdown */}
      {isNotifOpen && (
        <div className="md:hidden bg-white border-t border-gray-100">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <div className="font-semibold text-sm text-gray-800">
              Notifications
            </div>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500">
              No notifications yet.
            </div>
          ) : (
            <ul className="max-h-64 overflow-auto">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                    !n.read ? "bg-green-50/50" : ""
                  }`}
                  onClick={() => handleClickNotif(n)}
                >
                  <div className="text-sm font-semibold text-gray-800">
                    {n.title}
                  </div>
                  {n.message && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      {n.message}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-green-700 text-white px-4 pb-4 space-y-2">
          <Link
            to="/dashboard"
            className="block py-2 hover:text-green-200"
            onClick={() => setIsMenuOpen(false)}
          >
            Home
          </Link>
          <Link
            to="/schedule"
            className="block py-2 hover:text-green-200"
            onClick={() => setIsMenuOpen(false)}
          >
            Schedule
          </Link>
                    <Link
            to="/chatbot"
            className="block py-2 hover:text-green-200"
            onClick={() => setIsMenuOpen(false)}
          >
            Chat
          </Link>
          <div className="border-t border-green-600 mt-2 pt-2">
            <Link
              to="/profile"
              className="block py-2 hover:text-green-200"
              onClick={() => setIsMenuOpen(false)}
            >
              Profile
            </Link>
            <button
              onClick={() => {
                setIsMenuOpen(false);
                handleLogout();
              }}
              className="w-full text-left py-2 text-red-300 hover:text-red-400"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
