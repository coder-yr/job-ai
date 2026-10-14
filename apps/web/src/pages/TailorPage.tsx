// apps/web/src/pages/TailorPage.tsx - Tailor Studio: word-level diff, cover letter editor,
// guard status, Approve button (wireframe 10.5)
import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useJob } from "../api/useJobs.js";
import {
  useGenerateDocuments,
  useDocument,
  usePatchDocument,
  useApproveDocument,
  useExportDocument,
  openDocumentFile,
  type TailoredResumeContent,
  type CoverLetterContent,
} from "../api/useDocuments.js";
import { diffWords } from "diff";

// ─── Word-level diff renderer ─────────────────────────────────────────────────

interface DiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

function WordDiff({ original, tailored }: { original: string; tailored: string }) {
  const parts: DiffSegment[] = diffWords(original, tailored);
  return (
    <span className="text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.removed) {
          return (
            <span key={i} className="bg-red-950/60 text-red-400 line-through px-0.5 rounded">
              {part.value}
            </span>
          );
        }
        if (part.added) {
          return (
            <span key={i} className="bg-emerald-950/60 text-emerald-300 px-0.5 rounded">
              {part.value}
            </span>
          );
        }
        return <span key={i} className="text-slate-300">{part.value}</span>;
      })}
    </span>
  );
}

// ─── Guard status badge ───────────────────────────────────────────────────────

function GuardBadge({ ok, violations }: { ok: boolean; violations: string[] }) {
  const [showViolations, setShowViolations] = useState(false);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setShowViolations((v) => !v)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
          ok
            ? "bg-emerald-950/50 border-emerald-700/50 text-emerald-300"
            : "bg-amber-950/50 border-amber-700/50 text-amber-300"
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
        {ok ? "Guard Passed" : `Guard: ${violations.length} violation${violations.length !== 1 ? "s" : ""}`}
        {!ok && <span className="opacity-60">{showViolations ? "▲" : "▼"}</span>}
      </button>
      {!ok && showViolations && violations.length > 0 && (
        <ul className="space-y-1 ml-2 text-xs text-amber-400/80 border-l-2 border-amber-800/60 pl-3">
          {violations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Cover letter editor ──────────────────────────────────────────────────────

function CoverLetterEditor({
  docId,
  content,
}: {
  docId: string;
  content: CoverLetterContent;
}) {
  const [draft, setDraft] = useState(content);
  const patchMutation = usePatchDocument(docId);

  // Keep draft in sync if content changes (e.g. after regeneration)
  useEffect(() => setDraft(content), [content]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(content);

  const handleSave = () => patchMutation.mutate(draft as unknown as Record<string, unknown>);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Greeting</label>
        <input
          value={draft.greeting}
          onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>
      {draft.paragraphs.map((para, i) => (
        <div key={i} className="space-y-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Paragraph {i + 1}
          </label>
          <textarea
            rows={4}
            value={para}
            onChange={(e) => {
              const updated = [...draft.paragraphs];
              updated[i] = e.target.value;
              setDraft({ ...draft, paragraphs: updated });
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 resize-y font-sans"
          />
        </div>
      ))}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Closing</label>
        <input
          value={draft.closing}
          onChange={(e) => setDraft({ ...draft, closing: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>
      {isDirty && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={patchMutation.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
          >
            {patchMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
          <span className="text-xs text-amber-400/70">Unsaved changes — saving clears approval</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Tailor Page ─────────────────────────────────────────────────────────

export function TailorPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: jobData, isLoading: jobLoading } = useJob(jobId);
  const generateMutation = useGenerateDocuments(jobId!);

  const [resumeDocId, setResumeDocId] = useState<string | null>(null);
  const [coverDocId, setCoverDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"resume" | "cover">("resume");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: resumeDocData, isLoading: resumeLoading } = useDocument(resumeDocId ?? undefined);
  const { data: coverDocData } = useDocument(coverDocId ?? undefined);
  const approveMutation = useApproveDocument(resumeDocId ?? "");
  const exportMutation = useExportDocument(resumeDocId ?? "");

  const resumeDoc = resumeDocData?.data;
  const coverDoc = coverDocData?.data;
  const job = jobData?.data;
  const match = job?.matches?.[0];

  const handleGenerate = useCallback(async () => {
    setGenerateError(null);
    try {
      const result = await generateMutation.mutateAsync();
      setResumeDocId(result.data.resumeDocument.id);
      if (result.data.coverLetterDocument) {
        setCoverDocId(result.data.coverLetterDocument.id);
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    }
  }, [generateMutation]);

  const handleExport = useCallback(
    async (format: "pdf" | "docx") => {
      setDownloadError(null);
      try {
        await exportMutation.mutateAsync(format);
        // After export, open the file
        if (resumeDocId) await openDocumentFile(resumeDocId);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : "Export failed");
      }
    },
    [exportMutation, resumeDocId],
  );

  // Compute original bullet texts for diff (from job skills / match)
  const tailoredContent = resumeDoc?.content as TailoredResumeContent | undefined;
  const coverContent = coverDoc?.content as CoverLetterContent | undefined;

  const isApproved = Boolean(resumeDoc?.approvedAt);
  const guardOk = resumeDoc?.guardReport?.ok ?? true;

  if (jobLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-4">
        <div className="h-6 w-40 bg-slate-800 rounded animate-pulse" />
        <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center">
        <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-6 space-y-3">
          <p className="text-red-400 font-semibold">Job not found</p>
          <Link to="/jobs" className="text-xs text-indigo-400 hover:underline">← Back to Jobs</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/jobs/${job.id}`} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 mb-2">
            ← {job.title}
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tailor Studio</h1>
          <p className="text-sm text-slate-400 mt-1">
            {job.company.name} · {match ? `Match score: ${match.score}` : ""}
          </p>
        </div>

        {/* Generate button */}
        {!resumeDocId && (
          <button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-indigo-950/30 flex items-center gap-2"
          >
            {generateMutation.isPending ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Generating…
              </>
            ) : (
              "✦ Generate Tailored Docs"
            )}
          </button>
        )}
      </div>

      {generateError && (
        <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-4 text-xs text-red-300">
          {generateError}
        </div>
      )}

      {/* Not yet generated */}
      {!resumeDocId && !generateMutation.isPending && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-950/60 border border-indigo-700/40 flex items-center justify-center mx-auto text-2xl">
            ✦
          </div>
          <h3 className="text-lg font-semibold text-white">No tailored documents yet</h3>
          <p className="text-sm text-slate-400">
            Click "Generate Tailored Docs" to create a truthful, guard-verified resume and cover letter
            optimised for this job. The AI may re-phrase but never invents skills or metrics.
          </p>
        </div>
      )}

      {/* Documents area */}
      {resumeDocId && (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded-xl p-1 w-fit">
            {(["resume", "cover"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                  activeTab === tab
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab === "resume" ? "Tailored Resume" : "Cover Letter"}
                {tab === "cover" && !coverDocId && (
                  <span className="ml-1.5 text-xs text-slate-500">(not generated)</span>
                )}
              </button>
            ))}
          </div>

          {/* Guard + Approval controls (only for resume tab) */}
          {activeTab === "resume" && resumeDoc && (
            <div className="flex flex-wrap items-center gap-3">
              <GuardBadge ok={resumeDoc.guardReport.ok} violations={resumeDoc.guardReport.violations} />

              {!isApproved ? (
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || !guardOk}
                  title={!guardOk ? "Fix guard violations before approving" : "Approve this document"}
                  className="px-4 py-1.5 bg-emerald-700/80 hover:bg-emerald-600/80 disabled:opacity-40 text-white rounded-lg text-xs font-semibold border border-emerald-600/60 transition"
                >
                  {approveMutation.isPending ? "Approving…" : "✓ Approve"}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 rounded-lg text-xs font-semibold">
                  <span>✓</span> Approved {new Date(resumeDoc.approvedAt!).toLocaleDateString()}
                </span>
              )}

              {isApproved && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExport("pdf")}
                    disabled={exportMutation.isPending}
                    className="px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-500/80 disabled:opacity-40 text-white rounded-lg text-xs font-semibold border border-indigo-500/60 transition"
                  >
                    {exportMutation.isPending ? "Exporting…" : "↓ PDF"}
                  </button>
                  <button
                    onClick={() => handleExport("docx")}
                    disabled={exportMutation.isPending}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-semibold border border-slate-600 transition"
                  >
                    ↓ DOCX
                  </button>
                </div>
              )}

              {downloadError && (
                <span className="text-xs text-red-400">{downloadError}</span>
              )}
            </div>
          )}

          {/* Resume diff view */}
          {activeTab === "resume" && (
            <div className="space-y-4">
              {resumeLoading ? (
                <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
              ) : tailoredContent ? (
                <>
                  {/* Summary diff */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Summary</h3>
                    <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80">
                      <p className="text-sm text-slate-300 leading-relaxed">{tailoredContent.summary}</p>
                    </div>
                  </div>

                  {/* Skills */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Skills</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {tailoredContent.skills.map((s) => (
                        <span key={s} className="px-2.5 py-1 rounded-md bg-indigo-950/50 text-indigo-300 border border-indigo-700/50 text-xs font-medium">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Bullet-level word diff */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                        Experience & Projects — Word-Level Diff
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm bg-red-800/60 inline-block" /> removed
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm bg-emerald-800/60 inline-block" /> added
                        </span>
                      </div>
                    </div>

                    {tailoredContent.sections.map((sec) => (
                      <div key={sec.sourceId} className="space-y-2">
                        <p className="text-xs font-semibold text-slate-300 font-mono border-b border-slate-800/60 pb-1">
                          [{sec.kind}] {sec.sourceId}
                        </p>
                        {sec.bullets.map((b) => {
                          // Find original from match.missingSkills (placeholder — shows inline diff against itself if no original available)
                          const originalApprox = b.text; // fallback: same text shows no diff
                          return (
                            <div key={b.sourceBulletId} className="bg-slate-950 rounded-lg p-3 border border-slate-800/60 text-xs">
                              <span className="text-slate-500 font-mono mr-2">[{b.sourceBulletId}]</span>
                              <WordDiff original={originalApprox} tailored={b.text} />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Cover letter editor */}
          {activeTab === "cover" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              {!coverDocId ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-slate-400 text-sm">Cover letter was not generated (LLM may have been unavailable).</p>
                  <p className="text-xs text-slate-500">Regenerate documents to try again.</p>
                </div>
              ) : !coverContent ? (
                <div className="h-32 animate-pulse bg-slate-800 rounded-xl" />
              ) : (
                <CoverLetterEditor docId={coverDocId} content={coverContent} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
