import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullname: "",
    email: "",
    password: "",
    confirm: "",
    birthdate: "", // YYYY-MM-DD from <input type="date">
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    const { fullname, email, password, confirm, birthdate } = form;

    if (!fullname || !email || !password || !confirm || !birthdate) {
      return setMessage("⚠️ Please fill in all fields, including your birthdate.");
    }
    if (password !== confirm) {
      return setMessage("⚠️ Passwords do not match");
    }
    if (password.length < 8) {
      return setMessage("⚠️ Use at least 8 characters");
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fullname, email, password, birthdate }), // <-- send fullname + birthdate
      });

      let data = {};
      try { data = await res.json(); } 
      catch {
        console.log();
      }

      if (res.ok) {
        if (data.token) localStorage.setItem("token", data.token);
        if (data.user)  localStorage.setItem("user", JSON.stringify(data.user));

        if (!data.token) {
          setMessage("✅ Account created. Please sign in.");
          setTimeout(() => navigate("/login", { replace: true }), 700);
        } else {
          navigate("/dashboard", { replace: true });
        }
      } else {
        setMessage(data.error || "❌ Sign up failed");
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-4 bg-gradient-to-br from-green-200 to-green-50">
      <div className="w-full max-w-md p-10 bg-white rounded-3xl shadow-2xl border border-green-200">
        <h2 className="text-4xl font-extrabold text-green-800 text-center mb-8">
          Create your account
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fullname" className="block text-sm font-medium text-green-900 mb-1">
              Full name
            </label>
            <input
              id="fullname"
              name="fullname"
              type="text"
              autoComplete="name"
              value={form.fullname}
              onChange={onChange}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-green-900 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={onChange}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
              required
            />
          </div>

          <div>
            <label htmlFor="birthdate" className="block text-sm font-medium text-green-900 mb-1">
              Birthdate
            </label>
            <input
              id="birthdate"
              name="birthdate"
              type="date"
              value={form.birthdate}
              onChange={onChange}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Used to auto-create your next birthday event.
            </p>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-green-900 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={onChange}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
              required
              aria-describedby="password-help"
              minLength={8}
            />
            <p id="password-help" className="text-xs text-gray-500 mt-1">
              At least 8 characters.
            </p>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-green-900 mb-1">
              Confirm password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={onChange}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-800 text-white p-4 rounded-xl font-semibold hover:bg-green-900 shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-600">
          Already have an account?{" "}
          <Link to="/login" className="text-green-800 font-semibold hover:underline">
            Log in
          </Link>
        </p>

        <p
          className="mt-4 text-center text-red-600 min-h-[1.5rem]"
          aria-live="polite"
          role={message ? "alert" : undefined}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
