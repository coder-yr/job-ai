// apps/web/src/pages/JobsPage.tsx - Ranked job matches, filters, keyboard triage (wireframe 10.3)
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  useJobs,
  useSetJobState,
  useImportJob,
  type JobRow,
  type UserJobState,
} from "../api/useJobs.js";
import { ScoreBadge } from "../components/ScoreBadge.js";

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read filters from URL params
  const minScoreParam = searchParams.get("minScore");
  const minScore = minScoreParam !== null ? Number(minScoreParam) : 50;
  const state = (searchParams.get("state") as UserJobState) || undefined;
  const q = searchParams.get("q") || "";
  const remoteParam = searchParams.get("remote");
  const remote = remoteParam === "true" ? true : remoteParam === "false" ? false : undefined;
  const source = searchParams.get("source") || "";

  // Update URL params helper
  const updateFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const { data, isLoading, isError, error, refetch } = useJobs({
    minScore,
    state,
    q: q || undefined,
    remote,
    source: source || undefined,
  });

  const setJobStateMutation = useSetJobState();
  const importMutation = useImportJob();

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importForm, setImportForm] = useState({
    title: "",
    company: "",
    location: "",
    url: "",
    descriptionText: "",
  });
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const jobs = useMemo(() => data?.data ?? [], [data]);

  // Keep selected index in bounds when jobs list changes
  useEffect(() => {
    if (jobs.length > 0 && selectedIndex >= jobs.length) {
      setSelectedIndex(jobs.length - 1);
    }
  }, [jobs.length, selectedIndex]);

  const selectedJob = jobs[selectedIndex];

  // Keyboard navigation: j/k/s/h/o/t
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when user is typing in input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (jobs.length > 0 ? Math.min(jobs.length - 1, prev + 1) : 0));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "s") {
        if (selectedJob) {
          e.preventDefault();
          setJobStateMutation.mutate({ id: selectedJob.id, state: "SAVED" });
        }
      } else if (e.key === "h") {
        if (selectedJob) {
          e.preventDefault();
          setJobStateMutation.mutate({ id: selectedJob.id, state: "HIDDEN" });
        }
      } else if (e.key === "o") {
        if (selectedJob?.job.applyUrl) {
          e.preventDefault();
          window.open(selectedJob.job.applyUrl, "_blank", "noopener,noreferrer");
        }
      } else if (e.key === "t") {
        if (selectedJob) {
          e.preventDefault();
          navigate(`/tailor/${selectedJob.job.id}`);
        }
      }
    },
    [jobs.length, selectedJob, setJobStateMutation, navigate]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportStatus(null);
    try {
      await importMutation.mutateAsync({
        title: importForm.title,
        company: importForm.company,
        location: importForm.location || undefined,
        url: importForm.url || undefined,
        descriptionText: importForm.descriptionText,
      });
      setShowImportModal(false);
      setImportForm({ title: "", company: "", location: "", url: "", descriptionText: "" });
      refetch();
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "Failed to import job");
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Matched Jobs</h1>
          <p className="text-sm text-slate-400 mt-1">
            Ranked, explainable early-career opportunities. Keyboard-driven triage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
          >
            <span>+ Import Job / Paste JD</span>
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-4 py-2 text-xs text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-slate-300">Keyboard shortcuts:</span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">j</kbd> /{" "}
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">k</kbd> navigate
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">s</kbd> save
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">h</kbd> hide
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">o</kbd> open original
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-200">t</kbd> tailor
        </span>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-4 text-sm">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search titles..."
            value={q}
            onChange={(e) => updateFilter("q", e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
          />
        </div>

        {/* State tabs */}
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          {(["ALL", "NEW", "SAVED", "APPLIED", "HIDDEN"] as const).map((st) => {
            const active = st === "ALL" ? !state : state === st;
            return (
              <button
                key={st}
                onClick={() => updateFilter("state", st === "ALL" ? undefined : st)}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  active ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {st}
              </button>
            );
          })}
        </div>

        {/* Remote toggle */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-400">Remote:</label>
          <select
            value={remote === undefined ? "all" : String(remote)}
            onChange={(e) => updateFilter("remote", e.target.value === "all" ? undefined : e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs focus:outline-none"
          >
            <option value="all">Any</option>
            <option value="true">Remote only</option>
            <option value="false">Onsite / Hybrid</option>
          </select>
        </div>

        {/* Min Score slider */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-400">Min Score: <span className="font-semibold text-indigo-400">{minScore}</span></label>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => updateFilter("minScore", e.target.value)}
            className="w-24 accent-indigo-500 cursor-pointer"
          />
        </div>

        {/* Reset */}
        {(q || state || remote !== undefined || minScore !== 50 || source) && (
          <button
            onClick={() => setSearchParams(new URLSearchParams())}
            className="text-xs text-indigo-400 hover:underline ml-auto"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-6 text-center space-y-3">
          <p className="text-red-400 font-medium">Failed to load matching jobs</p>
          <p className="text-xs text-red-500/80 font-mono">{error instanceof Error ? error.message : "Unknown error"}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-white rounded-lg text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-xl font-bold">
            0
          </div>
          <h3 className="text-lg font-semibold text-white">No jobs found</h3>
          <p className="text-sm text-slate-400">
            {minScore > 50
              ? `No jobs match score >= ${minScore}. Try lowering the minimum score slider.`
              : "No jobs found with the current filters. Add company boards in Settings, or paste a job posting to get started."}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Link
              to="/settings"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition"
            >
              Configure Sources
            </Link>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition"
            >
              Import Job
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((row, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={row.id}
                onClick={() => setSelectedIndex(index)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-slate-900 border-indigo-500 ring-1 ring-indigo-500/50 shadow-lg shadow-indigo-950/20"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <ScoreBadge score={row.score} />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/jobs/${row.job.id}`}
                          className="text-base font-semibold text-white hover:text-indigo-400 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.job.title}
                        </Link>
                        <span className="text-sm text-slate-400 font-medium">• {row.job.company.name}</span>
                        {row.userState !== "NEW" && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              row.userState === "SAVED"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : row.userState === "APPLIED"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {row.userState}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                        {row.job.location && <span>📍 {row.job.location}</span>}
                        {row.job.workMode && (
                          <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono">
                            {row.job.workMode}
                          </span>
                        )}
                        {row.job.seniority && (
                          <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono">
                            {row.job.seniority}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() =>
                        setJobStateMutation.mutate({
                          id: row.id,
                          state: row.userState === "SAVED" ? "NEW" : "SAVED",
                        })
                      }
                      title="Save (s)"
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                        row.userState === "SAVED"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      {row.userState === "SAVED" ? "★ Saved" : "☆ Save"}
                    </button>

                    <button
                      onClick={() => setJobStateMutation.mutate({ id: row.id, state: "HIDDEN" })}
                      title="Hide (h)"
                      className="px-2.5 py-1 bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-700 rounded text-xs transition"
                    >
                      Hide
                    </button>

                    {row.job.applyUrl && (
                      <a
                        href={row.job.applyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Open original (o)"
                        className="px-2.5 py-1 bg-slate-800 text-indigo-400 hover:text-indigo-300 border border-slate-700 hover:bg-slate-700 rounded text-xs transition"
                      >
                        Open ↗
                      </a>
                    )}

                    <Link
                      to={`/jobs/${row.job.id}`}
                      className="px-3 py-1 bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 border border-indigo-500/40 rounded text-xs font-medium transition"
                    >
                      View Details
                    </Link>
                  </div>
                </div>

                {/* Skills tags preview */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5 text-xs">
                  {row.matchedSkills.slice(0, 5).map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/50"
                    >
                      ✓ {s}
                    </span>
                  ))}
                  {row.missingSkills.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700"
                    >
                      - {s}
                    </span>
                  ))}
                  {row.explanation && (
                    <p className="w-full text-xs text-slate-400 italic line-clamp-1 mt-1">
                      "{row.explanation}"
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Import Job Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Import Job Posting</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-200 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {importStatus && (
              <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-lg text-xs text-red-300">
                {importStatus}
              </div>
            )}

            <form onSubmit={handleImportSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Job Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Junior Backend Engineer"
                  value={importForm.title}
                  onChange={(e) => setImportForm({ ...importForm, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Company *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme Corp"
                    value={importForm.company}
                    onChange={(e) => setImportForm({ ...importForm, company: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Bengaluru / Remote"
                    value={importForm.location}
                    onChange={(e) => setImportForm({ ...importForm, location: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Original URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://company.greenhouse.io/..."
                  value={importForm.url}
                  onChange={(e) => setImportForm({ ...importForm, url: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Job Description Text * (Untrusted text)
                </label>
                <textarea
                  required
                  rows={6}
                  placeholder="Paste the full job description here..."
                  value={importForm.descriptionText}
                  onChange={(e) => setImportForm({ ...importForm, descriptionText: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importMutation.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                >
                  {importMutation.isPending ? "Importing & Extracting..." : "Import & Score"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
