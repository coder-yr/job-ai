// apps/web/src/components/NotificationBell.tsx - Notification bell with dropdown and SSE listener
import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useSseEvents,
  type NotificationItem,
} from "../api/useNotifications.js";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: notifData } = useNotifications();
  const notifications = notifData?.data || [];
  const unreadCount = notifData?.unreadCount ?? 0;

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // Listen to live SSE events
  useSseEvents();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotificationClick = (n: NotificationItem) => {
    if (!n.readAt) {
      markRead.mutate(n.id);
    }
    setOpen(false);

    if (n.refType === "application") {
      navigate("/tracker");
    } else if (n.refType === "search_run") {
      navigate("/jobs");
    } else if (n.refType === "job_source") {
      navigate("/settings");
    } else if (n.kind === "document_ready" && n.refId) {
      navigate(`/tailor/${n.refId}`);
    }
  };

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case "new_matches":
        return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="New matches" />;
      case "followup_due":
        return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Follow-up due" />;
      case "source_failing":
      case "run_failed":
        return <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" title="Source failing / Run failed" />;
      case "document_ready":
        return <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" title="Document ready" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 transition-all focus:outline-none"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          className="w-5 h-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-rose-500 rounded-full border-2 border-slate-900 shadow">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col text-xs text-slate-200 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950/50">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-slate-500">
                <p>No notifications yet</p>
                <p className="text-[11px] mt-1 text-slate-600">Daily search and follow-up alerts will appear here</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-3 transition-colors cursor-pointer hover:bg-slate-800/50 flex gap-2.5 items-start ${
                    !n.readAt ? "bg-slate-800/25" : "opacity-75"
                  }`}
                >
                  <div className="mt-1">{getKindBadge(n.kind)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`font-medium truncate ${!n.readAt ? "text-white" : "text-slate-300"}`}>
                        {n.title}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer with SSE Live indicator */}
          <div className="p-2 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[10px] text-slate-500 px-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Real-time SSE events connected</span>
            </span>
            <span>JobPilot v1.0</span>
          </div>
        </div>
      )}
    </div>
  );
}
