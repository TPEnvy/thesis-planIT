import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000"; // set in .env

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in, bounce to dashboard
  useEffect(() => {
    const user = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (user || token) navigate("/dashboard", { replace: true });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (!email || !password) return setMessage("⚠️ Please fill in all fields");

    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // If using httpOnly cookie sessions on the server, keep this line:
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      // Safely parse JSON even on error responses without bodies
      let data = {};
      try { data = await res.json();
       } 
      catch{
        console.log("");
      }

      if (res.ok) {
        // Prefer httpOnly cookies; but if the server returns a token, store minimally
        if (data.token) localStorage.setItem("token", data.token);
        if (data.user)  localStorage.setItem("user", JSON.stringify(data.user));
        navigate("/dashboard", { replace: true });
      } else {
        setMessage(data.error || "❌ Login failed");
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-4 bg-gradient-to-br from-green-200 to-green-50">
      <div className="w-full max-w-md p-10 bg-white rounded-3xl shadow-2xl border border-green-200">
        <h2 className="text-4xl font-extrabold text-green-800 text-center mb-8">
          Welcome Back
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-green-900 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-green-900 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-4 border border-green-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-800 text-white p-4 rounded-xl font-semibold hover:bg-green-900 shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-600">
          Don’t have an account?{" "}
          <Link to="/signup" className="text-green-800 font-semibold hover:underline">
            Sign Up
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
