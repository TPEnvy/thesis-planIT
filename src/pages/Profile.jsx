// src/pages/Profile.jsx
import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
const DEFAULT_TZ = "Asia/Manila";
const TZ_CHOICES = [
  { id: "auto", label: "Auto-detect (browser timezone)" },
  { id: "Asia/Manila", label: "Asia/Manila" },
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "America/New_York" },
  { id: "Europe/London", label: "Europe/London" },
  { id: "Asia/Tokyo", label: "Asia/Tokyo" },
];

function notify(title, message, href) {
  window.dispatchEvent(
    new CustomEvent("planit:notify", { detail: { title, message, href } })
  );
}

export default function Profile() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [msg, setMsg] = useState("");

  // Profile form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [theme, setTheme] = useState("system"); // "light" | "dark" | "system"
  const [notifyEnabled, setNotifyEnabled] = useState(true);

  // Password form
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  // Avatar
  const [avatarPreview, setAvatarPreview] = useState(null);
  const avatarFileRef = useRef(null);

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  const logoutAndRedirect = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    // Require auth
    const raw = localStorage.getItem("user");
    if (!raw) return logoutAndRedirect();
    let u;
    try {
      u = JSON.parse(raw);
      if (!u?.id) throw new Error();
    } catch {
      return logoutAndRedirect();
    }
    setUser(u);

    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setErrMsg("");
      setMsg("");
      try {
        const res = await fetch(`${API_BASE}/users/${u.id}`, {
          method: "GET",
          headers: authHeaders,
          credentials: "include",
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) return logoutAndRedirect();

        const data = res.ok ? await res.json().catch(() => ({})) : {};
        // Fallback to local user fields if API lacks them
        setName(data.name ?? u.name ?? "");
        setEmail(data.email ?? u.email ?? "");
        const tzFromApi = data.timezone ?? u.timezone ?? DEFAULT_TZ;
        setTimezone(tzFromApi);
        setTheme(data?.preferences?.theme ?? "system");
        setNotifyEnabled(
          (data?.preferences?.notifications ?? true) === true
        );
        if (data?.avatarUrl) setAvatarPreview(data.avatarUrl);
      } catch (e) {
        console.error(e);
        setErrMsg("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setErrMsg("");
    setMsg("");

    // Resolve timezone if "auto"
    const tz =
      timezone === "auto"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ
        : timezone;

    try {
      const res = await fetch(`${API_BASE}/users/${user.id}`, {
        method: "PUT",
        headers: authHeaders,
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          timezone: tz,
          preferences: {
            theme,
            notifications: notifyEnabled,
          },
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
         console.log();
      }

      if (!res.ok) {
        setErrMsg(data?.error || "Unable to save profile.");
        return;
      }

      // Sync localStorage copy
      const newLocal = { ...(JSON.parse(localStorage.getItem("user")) || {}), name, email, timezone: tz };
      localStorage.setItem("user", JSON.stringify(newLocal));

      setMsg("✅ Profile updated");
      notify("Profile saved", "Your profile changes have been applied.", "/profile");
    } catch (e) {
      console.error(e);
      setErrMsg("Network error while saving profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!user) return;

    if (!currentPwd || !newPwd || !confirmPwd) {
      setErrMsg("⚠️ Fill out all password fields.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setErrMsg("⚠️ New passwords do not match.");
      return;
    }
    if (newPwd.length < 8) {
      setErrMsg("⚠️ Use at least 8 characters for the new password.");
      return;
    }

    setPwdSaving(true);
    setErrMsg("");
    setMsg("");

    try {
      const res = await fetch(`${API_BASE}/users/${user.id}/password`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        console.log();
      }

      if (!res.ok) {
        setErrMsg(data?.error || "Unable to change password.");
        return;
      }

      setMsg("✅ Password updated");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      notify("Password changed", "Your password was updated successfully.");
    } catch (e) {
      console.error(e);
      setErrMsg("Network error while changing password.");
    } finally {
      setPwdSaving(false);
    }
  };

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrMsg("");
    setMsg("");

    // Preview
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);

    // Optional upload if your backend supports it
    try {
      const form = new FormData();
      form.append("avatar", file);
      const token = localStorage.getItem("token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/users/${user.id}/avatar`, {
        method: "POST",
        headers,
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        setErrMsg("Failed to upload avatar.");
      } else {
        setMsg("✅ Avatar updated");
        notify("Avatar updated", "Your profile photo has been changed.", "/profile");
      }
    } catch (e) {
      console.error(e);
      setErrMsg("Network error while uploading avatar.");
    }
  };

  const handleLogoutEverywhere = async () => {
    try {
      await fetch(`${API_BASE}/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    } finally {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
      <Navbar />
      <main className="flex-grow p-4 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-green-900 mb-4">Profile</h1>

          {/* Messages */}
          {errMsg && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800" role="alert" aria-live="polite">
              {errMsg}
            </div>
          )}
          {msg && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800" role="status" aria-live="polite">
              {msg}
            </div>
          )}

          {/* Skeleton */}
          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="h-64 rounded-2xl bg-white shadow animate-pulse" />
              <div className="h-64 rounded-2xl bg-white shadow animate-pulse" />
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Profile info card */}
              <section className="bg-white shadow-xl rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-green-900 mb-4">Account</h2>

                {/* Avatar */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 overflow-hidden flex items-center justify-center">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Avatar preview" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-green-700 text-sm">No Avatar</span>
                    )}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => avatarFileRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium"
                    >
                      Upload avatar
                    </button>
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarPick}
                      className="hidden"
                    />
                  </div>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-green-900 mb-1">
                      Full name
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-green-900 mb-1">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800"
                      required
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="timezone" className="block text-sm font-medium text-green-900 mb-1">
                        Timezone
                      </label>
                      <select
                        id="timezone"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 bg-white"
                      >
                        {TZ_CHOICES.map((tz) => (
                          <option key={tz.id} value={tz.id}>
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="theme" className="block text-sm font-medium text-green-900 mb-1">
                        Theme
                      </label>
                      <select
                        id="theme"
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 bg-white"
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={notifyEnabled}
                      onChange={(e) => setNotifyEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-green-300 text-green-700 focus:ring-green-700"
                    />
                    <span className="text-sm text-gray-700">
                      Enable in-app notifications
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full bg-green-800 text-white py-2.5 rounded-xl font-semibold hover:bg-green-900 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </form>
              </section>

              {/* Password card */}
              <section className="bg-white shadow-xl rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-green-900 mb-4">Change Password</h2>

                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label htmlFor="currentPwd" className="block text-sm font-medium text-green-900 mb-1">
                      Current password
                    </label>
                    <input
                      id="currentPwd"
                      type="password"
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800"
                      autoComplete="current-password"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="newPwd" className="block text-sm font-medium text-green-900 mb-1">
                      New password
                    </label>
                    <input
                      id="newPwd"
                      type="password"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="confirmPwd" className="block text-sm font-medium text-green-900 mb-1">
                      Confirm new password
                    </label>
                    <input
                      id="confirmPwd"
                      type="password"
                      value={confirmPwd}
                      onChange={(e) => setConfirmPwd(e.target.value)}
                      className="w-full p-3 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={pwdSaving}
                    className="w-full bg-green-800 text-white py-2.5 rounded-xl font-semibold hover:bg-green-900 disabled:opacity-60"
                  >
                    {pwdSaving ? "Updating..." : "Update password"}
                  </button>
                </form>

                {/* Danger zone */}
                <div className="mt-6 border-t pt-4">
                  <h3 className="text-sm font-semibold text-red-700 mb-2">Danger zone</h3>
                  <button
                    onClick={handleLogoutEverywhere}
                    className="w-full bg-red-600 text-white py-2.5 rounded-xl font-semibold hover:bg-red-700"
                  >
                    Log out everywhere
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
