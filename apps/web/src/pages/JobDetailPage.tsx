// apps/web/src/pages/JobDetailPage.tsx - Job match detail, explainable score breakdown, plain-text untrusted JD (wireframe 10.4)
import { useParams, Link } from "react-router-dom";
import { useJob, useSetJobState, useRescoreJob, type UserJobState } from "../api/useJobs.js";
import { ScoreBadge } from "../components/ScoreBadge.js";

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useJob(id);
  const setJobStateMutation = useSetJobState();
  const rescoreMutation = useRescoreJob();

  const job = data?.data;
  const match = job?.matches?.[0];

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div className="h-6 w-32 bg-slate-800 rounded animate-pulse" />
        <div className="h-32 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-96 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          <div className="h-96 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-6 space-y-3">
          <p className="text-red-400 font-semibold">Job not found or error loading</p>
          <p className="text-xs text-red-500 font-mono">
            {error instanceof Error ? error.message : "The requested job could not be retrieved."}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Link
              to="/jobs"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs transition"
            >
              ← Back to Jobs
            </Link>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-red-800/50 hover:bg-red-700/50 text-white rounded-lg text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const breakdown = match?.breakdown || {
    skills: 0,
    semantic: 0,
    title: 0,
    experience: 0,
    location: 0,
  };

  const dimensions = [
    { label: "Skills Overlap", weight: "40%", value: breakdown.skills },
    { label: "Semantic Alignment", weight: "20%", value: breakdown.semantic },
    { label: "Role Title Match", weight: "15%", value: breakdown.title },
    { label: "Experience & Seniority", weight: "15%", value: breakdown.experience },
    { label: "Location & Mode", weight: "10%", value: breakdown.location },
  ];

  const handleStateChange = (newState: UserJobState) => {
    if (match) {
      setJobStateMutation.mutate({ id: match.id, state: newState });
    }
  };

  const handleRescore = () => {
    if (job) {
      rescoreMutation.mutate(job.id);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <Link
          to="/jobs"
          className="text-xs text-slate-400 hover:text-slate-200 transition flex items-center gap-1 font-medium"
        >
          ← Back to Matched Jobs
        </Link>
        <div className="flex items-center gap-2">
          {job.applyUrl && (
            <a
              href={job.applyUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5 shadow-sm"
            >
              <span>Apply on Company Portal</span>
              <span>↗</span>
            </a>
          )}
          <Link
            to={`/tailor/${job.id}`}
            className="px-4 py-2 bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40 border border-emerald-500/40 rounded-lg text-xs font-medium transition"
          >
            Tailor Resume
          </Link>
        </div>
      </div>

      {/* Job Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white tracking-tight">{job.title}</h1>
              {match && <ScoreBadge score={match.score} />}
            </div>
            <div className="text-base text-slate-300 font-medium">
              🏢 {job.company.name}
              {job.location && <span className="text-slate-400 font-normal"> • 📍 {job.location}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              {job.workMode && (
                <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-slate-300 font-mono">
                  Mode: {job.workMode}
                </span>
              )}
              {job.seniority && (
                <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-slate-300 font-mono">
                  Level: {job.seniority}
                </span>
              )}
              {(job.minYears !== null || job.maxYears !== null) && (
                <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-slate-300 font-mono">
                  Exp: {job.minYears ?? 0}-{job.maxYears ?? "any"} yrs
                </span>
              )}
              {job.source && (
                <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-md text-slate-400 font-mono">
                  Source: {job.source.name}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons & triage controls */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              {(["NEW", "SAVED", "APPLIED", "HIDDEN"] as const).map((st) => {
                const active = match?.userState === st;
                return (
                  <button
                    key={st}
                    onClick={() => handleStateChange(st)}
                    className={`px-3 py-1 rounded-md font-medium transition ${
                      active ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleRescore}
              disabled={rescoreMutation.isPending}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium transition"
              title="Rescore match with current profile and LLM judge"
            >
              {rescoreMutation.isPending ? "Rescoring..." : "🔄 Rescore"}
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Match Analysis (Left) & Untrusted Job Description (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Match Breakdown & Skills (1 Column) */}
        <div className="space-y-6 lg:col-span-1">
          {/* Score breakdown card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">
              Score Breakdown
            </h3>

            <div className="space-y-3">
              {dimensions.map((dim) => {
                const pct = Math.round(dim.value * 100);
                return (
                  <div key={dim.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">{dim.label}</span>
                      <span className="text-slate-400 font-mono">
                        {pct}% <span className="text-slate-600">({dim.weight})</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {match?.llmAdjustment !== undefined && match.llmAdjustment !== 0 && (
              <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-xs">
                <span className="text-slate-400">LLM Judge Adjustment:</span>
                <span
                  className={`font-bold font-mono ${
                    match.llmAdjustment > 0 ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {match.llmAdjustment > 0 ? `+${match.llmAdjustment}` : match.llmAdjustment} pts
                </span>
              </div>
            )}
          </div>

          {/* Explanation card */}
          {match?.explanation && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                Why This Match
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                {match.explanation}
              </p>
            </div>
          )}

          {/* Skills Breakdown Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              Skills Analysis
            </h3>

            {/* Matched skills */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <span>✓ Matched Skills ({match?.matchedSkills.length ?? 0})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {match?.matchedSkills && match.matchedSkills.length > 0 ? (
                  match.matchedSkills.map((s) => (
                    <span
                      key={s}
                      className="px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 text-xs font-medium"
                    >
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500 italic">No direct skill matches</span>
                )}
              </div>
            </div>

            {/* Missing skills */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <span>! Missing Required Skills ({match?.missingSkills.length ?? 0})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {match?.missingSkills && match.missingSkills.length > 0 ? (
                  match.missingSkills.map((s) => (
                    <span
                      key={s}
                      className="px-2.5 py-1 rounded-md bg-slate-950 text-slate-400 border border-slate-800 text-xs"
                    >
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-emerald-400/80 italic">All required skills present!</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Untrusted Job Description (2 Columns) */}
        <div className="space-y-4 lg:col-span-2">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Original Job Description</h3>
              <span className="text-xs text-amber-400/90 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-800/50">
                Untrusted Plain Text (No HTML)
              </span>
            </div>

            {/*
              SECURITY INVARIANT:
              The job description is strictly rendered as plain text inside a standard element.
              NEVER dangerouslySetInnerHTML.
            */}
            <div className="whitespace-pre-wrap font-sans text-slate-300 leading-relaxed text-sm bg-slate-950 p-6 rounded-xl border border-slate-800/90 max-h-[700px] overflow-y-auto select-text">
              {job.descriptionText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
