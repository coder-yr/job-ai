import React from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { ResumePage } from "./pages/ResumePage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { JobDetailPage } from "./pages/JobDetailPage.js";
import { TailorPage } from "./pages/TailorPage.js";
import { TrackerPage } from "./pages/TrackerPage.js";

import { NotificationBell } from "./components/NotificationBell.js";

// Layout with sidebar navigation
function RootLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const navItems = [
    { name: "Dashboard", path: "/" },
    { name: "Resume", path: "/resume" },
    { name: "Jobs", path: "/jobs" },
    { name: "Tracker", path: "/tracker" },
    { name: "Settings", path: "/settings" },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              JobPilot AI
            </span>
          </div>
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const active = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Status indicator in footer */}
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
            <span>Local Monolith</span>
          </div>
          <div>127.0.0.1:4000</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-14 border-b border-slate-800/80 bg-slate-900/40 backdrop-blur px-6 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 font-medium">
            Autonomous Daily Search &bull; 100% On-Device
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      <p className="text-sm text-slate-400">{description}</p>
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 text-sm">
        This view is scheduled in upcoming implementation phases. Switch to the <Link to="/resume" className="text-indigo-400 underline">Resume Analyzer</Link> to inspect Phase 2 functionality.
      </div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <RootLayout>
      <Routes>
        <Route path="/" element={<PlaceholderPage title="Dashboard" description="Today's top matched roles, pipeline overview, and reminders." />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/tailor/:id" element={<TailorPage />} />
        <Route path="/tracker" element={<TrackerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Routes>
    </RootLayout>
  );
}
