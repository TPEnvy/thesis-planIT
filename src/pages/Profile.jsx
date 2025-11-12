// src/pages/Profile.jsx
import { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const API_URL = "http://localhost:5000";

function Toast({ kind = "info", message = "", onClose }) {
  if (!message) return null;
  const styles =
    kind === "success"
      ? "bg-emerald-600"
      : kind === "error"
      ? "bg-rose-600"
      : "bg-slate-700";
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className={`text-white px-4 py-2 rounded-lg shadow-lg ${styles}`}>
        <div className="flex items-center gap-3">
          <span className="text-sm">{message}</span>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-xs underline"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  const [authUser, setAuthUser] = useState(() => {
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const userId = authUser?.id || "";

  // Profile form state
  const [fullname, setFullname] = useState("");
  const [email, setEmail] = useState("");

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");

  // UI state
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Toast
  const [toast, setToast] = useState({ kind: "info", message: "" });
  const showToast = (kind, message) => {
    setToast({ kind, message });
    // Auto-hide after 3.5s
    window.clearTimeout((showToast._tid || 0));
    showToast._tid = window.setTimeout(() => setToast({ kind: "info", message: "" }), 3500);
  };

  // Derived validations
  const emailValid = useMemo(() => {
    if (!email) return false;
    // simple email check
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [email]);

  const nameValid = useMemo(() => (fullname || "").trim().length >= 2, [fullname]);

  const passwordMatch = useMemo(() => newPassword === confirmNew, [newPassword, confirmNew]);
  const passwordStrong = useMemo(() => (newPassword || "").length >= 8, [newPassword]);

  // Load profile
  useEffect(() => {
    const load = async () => {
      if (!userId) return;
      setLoadingProfile(true);
      try {
        const res = await fetch(`${API_URL}/users/${userId}`);
        if (!res.ok) {
          if (res.status === 404) {
            showToast("error", "User not found.");
          } else {
            showToast("error", "Failed to fetch profile.");
          }
          return;
        }
        const data = await res.json();
        setFullname(data?.fullname || authUser?.fullname || "");
        setEmail(data?.email || authUser?.email || "");
      } catch {
        showToast("error", "Network error while loading profile.");
      } finally {
        setLoadingProfile(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Save profile (fullname + email)
  const onSaveProfile = async (e) => {
    e.preventDefault();
    if (!userId) {
      showToast("error", "You are not logged in.");
      return;
    }
    if (!nameValid || !emailValid) {
      showToast("error", "Please enter a valid name and email.");
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch(`${API_URL}/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullname: fullname.trim(), email: email.trim() }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          showToast("error", "Updating profile is not available on the server.");
        } else if (res.status === 409) {
          showToast("error", "Email already in use.");
        } else {
          const msg = (await res.json().catch(() => ({})))?.error || "Failed to update profile.";
          showToast("error", msg);
        }
        return;
      }

      const updated = await res.json();
      // Keep localStorage in sync for Navbar, etc.
      const merged = {
        ...authUser,
        fullname: updated?.fullname || fullname.trim(),
        email: updated?.email || email.trim(),
      };
      setAuthUser(merged);
      localStorage.setItem("user", JSON.stringify(merged));

      showToast("success", "Profile updated successfully.");
    } catch {
      showToast("error", "Network error while saving profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  // Change password
  const onChangePassword = async (e) => {
    e.preventDefault();
    if (!userId) {
      showToast("error", "You are not logged in.");
      return;
    }
    if (!currentPassword || !passwordStrong || !passwordMatch) {
      showToast(
        "error",
        !currentPassword
          ? "Please enter your current password."
          : !passwordStrong
          ? "New password must be at least 8 characters."
          : "New passwords do not match."
      );
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch(`${API_URL}/users/${userId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          showToast("error", "Password change is not available on the server.");
        } else if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          showToast("error", body?.error || "Invalid request. Check your inputs.");
        } else if (res.status === 401) {
          showToast("error", "Current password is incorrect.");
        } else {
          const body = await res.json().catch(() => ({}));
          showToast("error", body?.error || "Failed to change password.");
        }
        return;
      }

      // Success
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNew("");
      showToast("success", "Password changed successfully.");
    } catch {
      showToast("error", "Network error while changing password.");
    } finally {
      setSavingPassword(false);
    }
  };

  if (!authUser) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
        <Navbar />
        <main className="flex-grow flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-md w-full">
            <h1 className="text-2xl font-bold text-gray-800">You’re signed out</h1>
            <p className="text-gray-600 mt-2">Please sign in to view your profile.</p>
            <a
              href="/login"
              className="inline-block mt-4 bg-green-700 text-white px-5 py-2 rounded-lg hover:bg-green-800"
            >
              Go to Login
            </a>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-green-200 to-green-50">
      <Navbar />
      <main className="flex-grow p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center text-green-800 font-bold">
                {fullname?.[0]?.toUpperCase() || authUser.fullname?.[0]?.toUpperCase() || "U"}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-green-900">Account</h1>
                <p className="text-sm text-gray-600">
                  Manage your profile and password
                </p>
              </div>
            </div>
          </div>

          {/* Profile Form */}
          <section className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
            <p className="text-sm text-gray-600 mb-4">Update your name and email.</p>

            <form onSubmit={onSaveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Full name</label>
                <input
                  type="text"
                  value={fullname}
                  onChange={(e) => setFullname(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-green-600 outline-none"
                  placeholder="Your full name"
                  autoComplete="name"
                />
                {!nameValid && (
                  <p className="text-xs text-rose-600 mt-1">
                    Name must be at least 2 characters.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-green-600 outline-none"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                {!emailValid && email && (
                  <p className="text-xs text-rose-600 mt-1">Enter a valid email.</p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingProfile || !nameValid || !emailValid}
                  className={`px-4 py-2 rounded-lg text-white font-medium ${
                    savingProfile || !nameValid || !emailValid
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-700 hover:bg-green-800"
                  }`}
                >
                  {savingProfile ? "Saving…" : "Save changes"}
                </button>
                {loadingProfile && (
                  <span className="text-sm text-gray-500">Loading profile…</span>
                )}
              </div>
            </form>
          </section>

          {/* Password Form */}
          <section className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
            <p className="text-sm text-gray-600 mb-4">
              Use at least 8 characters for a strong password.
            </p>

            <form onSubmit={onChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-green-600 outline-none"
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-green-600 outline-none"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                  {!passwordStrong && newPassword && (
                    <p className="text-xs text-rose-600 mt-1">
                      New password must be at least 8 characters.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmNew}
                    onChange={(e) => setConfirmNew(e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-green-600 outline-none"
                    autoComplete="new-password"
                    placeholder="Repeat new password"
                  />
                  {!passwordMatch && confirmNew && (
                    <p className="text-xs text-rose-600 mt-1">Passwords do not match.</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={
                    savingPassword ||
                    !currentPassword ||
                    !passwordStrong ||
                    !passwordMatch
                  }
                  className={`px-4 py-2 rounded-lg text-white font-medium ${
                    savingPassword ||
                    !currentPassword ||
                    !passwordStrong ||
                    !passwordMatch
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-700 hover:bg-green-800"
                  }`}
                >
                  {savingPassword ? "Updating…" : "Change password"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>

      <Footer />

      <Toast
        kind={toast.kind}
        message={toast.message}
        onClose={() => setToast({ kind: "info", message: "" })}
      />
    </div>
  );
}
