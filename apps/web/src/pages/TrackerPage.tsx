// apps/web/src/pages/TrackerPage.tsx - Kanban Application Tracker with @dnd-kit (wireframe 10.6)
import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  useApplications,
  useUpdateApplication,
  useAssistApply,
  useProposals,
  useAcceptProposal,
  useDismissProposal,
  type ApplicationItem,
  type ApplicationStatus,
} from "../api/useApplications.js";

// Fig 5.8 state machine transitions
const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PLANNED: ["PREPARED", "WITHDRAWN"],
  PREPARED: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["ACKNOWLEDGED", "GHOSTED", "WITHDRAWN"],
  ACKNOWLEDGED: ["SCREENING", "GHOSTED", "WITHDRAWN"],
  SCREENING: ["ASSESSMENT", "INTERVIEW", "REJECTED", "WITHDRAWN"],
  ASSESSMENT: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: [],
  REJECTED: [],
  WITHDRAWN: [],
  GHOSTED: [],
};

function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

const COLUMNS: Array<{ id: ApplicationStatus; label: string; color: string; badge: string }> = [
  { id: "PLANNED", label: "Planned", color: "border-slate-700 bg-slate-900/40", badge: "bg-slate-800 text-slate-300" },
  { id: "PREPARED", label: "Prepared", color: "border-cyan-800/60 bg-cyan-950/20", badge: "bg-cyan-900/60 text-cyan-300" },
  { id: "SUBMITTED", label: "Submitted", color: "border-blue-800/60 bg-blue-950/20", badge: "bg-blue-900/60 text-blue-300" },
  { id: "ACKNOWLEDGED", label: "Acknowledged", color: "border-indigo-800/60 bg-indigo-950/20", badge: "bg-indigo-900/60 text-indigo-300" },
  { id: "SCREENING", label: "Screening", color: "border-purple-800/60 bg-purple-950/20", badge: "bg-purple-900/60 text-purple-300" },
  { id: "INTERVIEW", label: "Interview", color: "border-amber-800/60 bg-amber-950/20", badge: "bg-amber-900/60 text-amber-300" },
  { id: "ASSESSMENT", label: "Assessment", color: "border-orange-800/60 bg-orange-950/20", badge: "bg-orange-900/60 text-orange-300" },
  { id: "OFFER", label: "Offer", color: "border-emerald-800/60 bg-emerald-950/20", badge: "bg-emerald-900/60 text-emerald-300" },
  { id: "REJECTED", label: "Rejected", color: "border-rose-800/40 bg-rose-950/10", badge: "bg-rose-900/40 text-rose-300" },
  { id: "WITHDRAWN", label: "Withdrawn", color: "border-slate-800 bg-slate-950/30", badge: "bg-slate-800 text-slate-400" },
  { id: "GHOSTED", label: "Ghosted", color: "border-zinc-800 bg-zinc-950/20", badge: "bg-zinc-800 text-zinc-400" },
];

export function TrackerPage() {
  const { data, isLoading, refetch } = useApplications();
  const updateApp = useUpdateApplication();
  const assistApply = useAssistApply();
  const { data: proposalsData } = useProposals();
  const acceptProposal = useAcceptProposal();
  const dismissProposal = useDismissProposal();

  // Drag confirmation modal state
  const [confirmMove, setConfirmMove] = useState<{
    app: ApplicationItem;
    targetStatus: ApplicationStatus;
    note: string;
  } | null>(null);

  // Illegal transition error modal
  const [transitionError, setTransitionError] = useState<{
    from: ApplicationStatus;
    to: ApplicationStatus;
    message: string;
  } | null>(null);

  // Assist toast state
  const [assistToast, setAssistToast] = useState<{
    message: string;
    captcha?: boolean;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const applications = data?.data ?? [];
  const proposals = proposalsData?.data ?? [];

  // Group applications by status
  const groupedApps = useMemo(() => {
    const map = new Map<ApplicationStatus, ApplicationItem[]>();
    for (const col of COLUMNS) {
      map.set(col.id, []);
    }
    for (const app of applications) {
      const list = map.get(app.status) || [];
      list.push(app);
      map.set(app.status, list);
    }
    return map;
  }, [applications]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const appId = active.id as string;
    const targetStatus = over.id as ApplicationStatus;
    const targetApp = applications.find((a) => a.id === appId);

    if (!targetApp || targetApp.status === targetStatus) return;

    if (!canTransition(targetApp.status, targetStatus)) {
      setTransitionError({
        from: targetApp.status,
        to: targetStatus,
        message: `Fig 5.8 State Machine Rule: Cannot transition directly from ${targetApp.status} to ${targetStatus}.`,
      });
      return;
    }

    // Opens the confirmation modal - drag changes status ONLY after confirm
    setConfirmMove({
      app: targetApp,
      targetStatus,
      note: "",
    });
  };

  const handleConfirmMove = async () => {
    if (!confirmMove) return;
    try {
      await updateApp.mutateAsync({
        id: confirmMove.app.id,
        status: confirmMove.targetStatus,
        note: confirmMove.note.trim() || undefined,
      });
      setConfirmMove(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      alert(msg);
    }
  };

  const handleAssistClick = async (appId: string) => {
    try {
      const res = await assistApply.mutateAsync(appId);
      setAssistToast({
        message: res.data.message || "Assisted fill launched in visible browser.",
        captcha: res.data.captchaDetected,
      });
      setTimeout(() => setAssistToast(null), 8000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Assist apply failed";
      alert(msg);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Application Tracker</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
              Kanban
            </span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Track every role through the pipeline with human confirmation gates and assisted apply.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/jobs"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            + Save Roles from Jobs
          </Link>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
          >
            Refresh Board
          </button>
        </div>
      </div>

      {/* Assist Apply Toast Notification */}
      {assistToast && (
        <div className="p-4 rounded-xl bg-indigo-950/80 border border-indigo-500/40 text-slate-200 text-sm flex items-start justify-between gap-3 shadow-lg">
          <div>
            <div className="font-semibold text-indigo-300 flex items-center gap-2">
              <span>🚀 Assisted Fill Active</span>
              {assistToast.captcha && (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs border border-amber-500/30 font-medium">
                  CAPTCHA Detected
                </span>
              )}
            </div>
            <p className="mt-1 text-slate-300 text-xs">{assistToast.message}</p>
            {assistToast.captcha && (
              <p className="mt-1 text-amber-400 text-xs font-medium">
                Note: Solve the CAPTCHA yourself in the visible browser window. Never submit automatically.
              </p>
            )}
          </div>
          <button
            onClick={() => setAssistToast(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Email Classification Proposals Banner */}
      {proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-500/40 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base">✉️</span>
                  <span className="font-semibold text-sm text-indigo-200">
                    Email Update Detected: {p.company}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                    Proposed: {p.proposedStatus}
                  </span>
                  <span className="text-xs text-slate-400">
                    Confidence: {Math.round(p.confidence * 100)}%
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Subject: <span className="text-slate-100 font-medium">"{p.subject}"</span>
                  {p.nextStepDate && <span> &bull; Next step: {p.nextStepDate}</span>}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => acceptProposal.mutate(p.id)}
                  disabled={acceptProposal.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow disabled:opacity-50"
                >
                  Accept Change
                </button>
                <button
                  onClick={() => dismissProposal.mutate(p.id)}
                  disabled={dismissProposal.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Kanban Board with @dnd-kit */}
      {isLoading ? (
        <div className="py-20 text-center text-slate-400">Loading applications pipeline...</div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-6 pt-2 scrollbar-thin">
            {COLUMNS.map((col) => {
              const colApps = groupedApps.get(col.id) || [];
              return (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  applications={colApps}
                  onAssistClick={handleAssistClick}
                />
              );
            })}
          </div>
        </DndContext>
      )}

      {/* Confirmation Step Modal */}
      {confirmMove && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Confirm Application Status Move</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Phase 6 Safety Gate: Application state updates require explicit confirmation.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-2 text-xs">
              <div>
                <span className="text-slate-400">Role: </span>
                <span className="font-semibold text-slate-100">{confirmMove.app.job.title}</span>
              </div>
              <div>
                <span className="text-slate-400">Company: </span>
                <span className="font-semibold text-slate-100">
                  {typeof confirmMove.app.job.company === "object"
                    ? confirmMove.app.job.company.name
                    : confirmMove.app.job.company}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
                <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-medium">
                  {confirmMove.app.status}
                </span>
                <span className="text-slate-400">&rarr;</span>
                <span className="px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 font-bold border border-indigo-500/30">
                  {confirmMove.targetStatus}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Event Note (optional)</label>
              <textarea
                value={confirmMove.note}
                onChange={(e) =>
                  setConfirmMove({ ...confirmMove, note: e.target.value })
                }
                placeholder="e.g. Sent application via Ashby portal, completed assessment link..."
                rows={2}
                className="w-full text-xs bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmMove(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMove}
                disabled={updateApp.isPending}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition shadow disabled:opacity-50"
              >
                {updateApp.isPending ? "Updating..." : "Confirm Move"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Illegal Transition Warning Modal */}
      {transitionError && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-800/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
              <span>⛔ Illegal Transition Refused</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {transitionError.message}
            </p>
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200">
              Allowed transitions from <span className="font-bold">{transitionError.from}</span>:{" "}
              {ALLOWED_TRANSITIONS[transitionError.from]?.length > 0
                ? ALLOWED_TRANSITIONS[transitionError.from]?.join(", ")
                : "None (terminal state)"}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setTransitionError(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 transition"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Kanban Droppable Column
function KanbanColumn({
  column,
  applications,
  onAssistClick,
}: {
  column: { id: ApplicationStatus; label: string; color: string; badge: string };
  applications: ApplicationItem[];
  onAssistClick: (appId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-2xl border flex flex-col max-h-[calc(100vh-220px)] transition-all ${
        column.color
      } ${isOver ? "ring-2 ring-indigo-400 bg-indigo-950/20" : ""}`}
    >
      {/* Column Header */}
      <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-slate-200">{column.label}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${column.badge}`}>
            {applications.length}
          </span>
        </div>
      </div>

      {/* Column Cards */}
      <div className="p-2.5 overflow-y-auto space-y-2.5 flex-1 scrollbar-thin">
        {applications.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-600 italic">No roles</div>
        ) : (
          applications.map((app) => (
            <KanbanCard
              key={app.id}
              application={app}
              onAssistClick={onAssistClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Kanban Draggable Card
function KanbanCard({
  application,
  onAssistClick,
}: {
  application: ApplicationItem;
  onAssistClick: (appId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
  };

  const companyName =
    typeof application.job.company === "object"
      ? application.job.company.name
      : application.job.company;

  const hasTailoredDoc = application.documents.some((d) => d.kind === "TAILORED_RESUME");
  const isApproved = application.documents.some(
    (d) => d.kind === "TAILORED_RESUME" && Boolean(d.approvedAt),
  );

  const isATS =
    application.job.applyUrl &&
    /(greenhouse|lever\.co|ashbyhq)/i.test(application.job.applyUrl);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-sm space-y-2.5 group select-none"
    >
      {/* Title & Company */}
      <div>
        <h4 className="font-semibold text-xs text-slate-100 group-hover:text-indigo-300 transition line-clamp-1">
          {application.job.title}
        </h4>
        <div className="text-[11px] text-slate-400 font-medium">{companyName}</div>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {hasTailoredDoc ? (
          <span
            className={`px-1.5 py-0.5 rounded font-medium border ${
              isApproved
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/40"
                : "bg-amber-950/60 text-amber-300 border-amber-800/40"
            }`}
          >
            {isApproved ? "✓ Docs Approved" : "Draft Docs"}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded font-medium bg-slate-800 text-slate-400">
            Base Resume
          </span>
        )}

        {application.followUpAt && (
          <span className="px-1.5 py-0.5 rounded font-medium bg-indigo-950/60 text-indigo-300 border border-indigo-800/40">
            Follow-up: {new Date(application.followUpAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div
        className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]"
        onPointerDown={(e) => e.stopPropagation()} // don't drag when clicking buttons
      >
        <Link
          to={`/jobs/${application.jobId}`}
          className="text-slate-400 hover:text-slate-200 transition"
        >
          View Job
        </Link>

        {isATS ? (
          <button
            onClick={() => onAssistClick(application.id)}
            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 transition flex items-center gap-1"
            title="Pre-fill employer form safely in visible browser"
          >
            <span>🤖 Assist Apply</span>
          </button>
        ) : application.job.applyUrl ? (
          <a
            href={application.job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 transition text-[10px]"
          >
            Apply &rarr;
          </a>
        ) : null}
      </div>
    </div>
  );
}
