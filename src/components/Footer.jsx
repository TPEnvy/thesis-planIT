// src/components/Footer.jsx
import { Link } from "react-router-dom";

const YEAR = new Date().getFullYear();
const APP_NAME = import.meta.env.VITE_APP_NAME ?? "PlanIT";
const APP_VERSION = import.meta.env.VITE_APP_VERSION; // e.g., set in .env

export default function Footer() {
  return (
    <footer
      className="bg-green-800 text-white/90 border-t border-green-700/40 mt-auto shadow-inner"
      role="contentinfo"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-white">
            &copy; {YEAR} <span className="font-semibold">{APP_NAME}</span>. All rights reserved.
            {APP_VERSION && <span className="ml-2 text-white/70">v{APP_VERSION}</span>}
          </p>

          <nav className="text-xs flex items-center gap-4">
            <Link to="/privacy" className="hover:underline">Privacy</Link>
            <Link to="/terms" className="hover:underline">Terms</Link>
            <a href="mailto:support@example.com" className="hover:underline">Support</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
