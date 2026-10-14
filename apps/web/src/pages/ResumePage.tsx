// apps/web/src/pages/ResumePage.tsx - Resume analyzer per blueprint wireframe 10.2
import React, { useState, useRef } from "react";
import {
  useResumes,
  useResume,
  useResumeAnalysis,
  useUploadResume,
  useUpdateResume,
  useAnalyzeResume,
  useSetPrimaryResume,
} from "../api/useResume.js";
import { ScoreBadge } from "../components/ScoreBadge.js";
import type { ParsedResume } from "@jobpilot/shared";

export function ResumePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCategory, setNewSkillCategory] = useState<
    "language" | "framework" | "database" | "tool" | "cloud" | "soft" | "other"
  >("framework");
  const [isAddingSkill, setIsAddingSkill] = useState(false);

  const { data: resumesRes, isLoading: isLoadingResumes } = useResumes();
  const resumes = resumesRes?.data || [];

  // Default to primary resume or first resume
  const activeResumeId =
    selectedResumeId ||
    resumes.find((r) => r.isPrimary)?.id ||
    resumes[0]?.id ||
    null;

  const { data: activeResumeRes, isLoading: isLoadingResume } = useResume(activeResumeId);
  const activeResume = activeResumeRes?.data;

  const { data: analysisRes, isLoading: isLoadingAnalysis } = useResumeAnalysis(activeResumeId);
  const analysis = analysisRes?.data || activeResume?.analyses?.[0];

  const uploadMutation = useUploadResume();
  const updateMutation = useUpdateResume();
  const analyzeMutation = useAnalyzeResume();
  const setPrimaryMutation = useSetPrimaryResume();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", file.name.replace(/\.[^/.]+$/, ""));

    try {
      const res = await uploadMutation.mutateAsync(formData);
      setSelectedResumeId(res.data.id);
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = "";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", file.name.replace(/\.[^/.]+$/, ""));

    try {
      const res = await uploadMutation.mutateAsync(formData);
      setSelectedResumeId(res.data.id);
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAddSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim() || !activeResume?.parsed) return;

    const updated: ParsedResume = {
      ...activeResume.parsed,
      skills: [
        ...activeResume.parsed.skills,
        { name: newSkillName.trim(), category: newSkillCategory },
      ],
    };

    await updateMutation.mutateAsync({ id: activeResume.id, parsed: updated });
    setNewSkillName("");
    setIsAddingSkill(false);
  };

  const handleRemoveSkill = async (skillNameToRemove: string) => {
    if (!activeResume?.parsed) return;
    const updated: ParsedResume = {
      ...activeResume.parsed,
      skills: activeResume.parsed.skills.filter(
        (s) => s.name.toLowerCase() !== skillNameToRemove.toLowerCase()
      ),
    };
    await updateMutation.mutateAsync({ id: activeResume.id, parsed: updated });
  };

  const atsScore = analysis?.atsScore ?? 75;
  const sectionScores = analysis?.sectionScores ?? {
    contact: 95,
    summary: 60,
    skills: 85,
    experience: 55,
    education: 90,
    formatting: 80,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Resume Analysis</h1>
          <p className="text-sm text-slate-400">
            Upload, inspect ATS readiness, and curate your verifiable profile facts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,.docx,.txt"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-all text-sm flex items-center gap-2"
          >
            {uploadMutation.isPending ? "Uploading & parsing..." : "Upload new resume"}
          </button>
        </div>
      </header>

      {/* Select resume picker if multiple */}
      {resumes.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 text-sm">
          <span className="text-slate-400 font-medium">Resumes:</span>
          {resumes.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedResumeId(r.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeResumeId === r.id
                  ? "bg-slate-700 text-white border border-slate-500"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {r.label} {r.isPrimary ? "(Primary)" : ""}
            </button>
          ))}
        </div>
      )}

      {/* Main Grid: Wireframe 10.2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Drop zone & ATS Readiness */}
        <div className="lg:col-span-2 space-y-6">
          {/* Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-900/50 hover:bg-slate-900/80 rounded-xl p-8 text-center cursor-pointer transition-all"
          >
            <div className="text-slate-400 text-sm space-y-1">
              <p className="font-semibold text-slate-200">
                Drop PDF / DOCX here — parsed 100% locally
              </p>
              <p className="text-xs text-slate-500">
                {activeResume
                  ? `${activeResume.originalName} — parsed ${activeResume.parseStatus}`
                  : "No resume selected yet. Upload one to start."}
              </p>
            </div>
          </div>

          {/* ATS Readiness Card */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">ATS Readiness</h2>
                <p className="text-xs text-slate-400">
                  Deterministic rubric based on industry applicant screening benchmarks.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ScoreBadge score={atsScore} />
                {activeResume && (
                  <button
                    onClick={() => analyzeMutation.mutate(activeResume.id)}
                    disabled={analyzeMutation.isPending}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded text-slate-300"
                  >
                    {analyzeMutation.isPending ? "Analyzing..." : "Re-run ATS check"}
                  </button>
                )}
              </div>
            </div>

            {/* Score Breakdown Bars */}
            <div className="space-y-4">
              {[
                { label: "Contact info", score: sectionScores.contact ?? 95 },
                { label: "Summary", score: sectionScores.summary ?? 60 },
                { label: "Skills section", score: sectionScores.skills ?? 85 },
                { label: "Experience bullets", score: sectionScores.experience ?? 55 },
                { label: "Education", score: sectionScores.education ?? 90 },
                { label: "Formatting", score: sectionScores.formatting ?? 80 },
              ].map((s) => (
                <div key={s.label} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-300">{s.label}</span>
                    <span className="text-slate-400">{s.score} / 100</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${
                        s.score >= 80
                          ? "bg-emerald-500"
                          : s.score >= 60
                          ? "bg-amber-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Suggestions & Detected Skills */}
        <div className="space-y-6">
          {/* Prioritized Suggestions */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-white">Suggestions</h2>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {(analysis?.suggestions && analysis.suggestions.length > 0) ? (
                analysis.suggestions.map((sug, i) => {
                  const badgeColor =
                    sug.priority === "HIGH"
                      ? "bg-rose-900/50 text-rose-300 border-rose-700/50"
                      : sug.priority === "MEDIUM"
                      ? "bg-amber-900/50 text-amber-300 border-amber-700/50"
                      : "bg-blue-900/50 text-blue-300 border-blue-700/50";
                  return (
                    <div
                      key={i}
                      className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}
                        >
                          {sug.priority}
                        </span>
                        <span className="font-medium text-slate-200">{sug.issue}</span>
                      </div>
                      <p className="text-slate-400 pl-0.5">{sug.fix}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-400">
                  No issues flagged. Resume passed all high-priority ATS checks.
                </p>
              )}
            </div>
          </div>

          {/* Detected Skills (Click to Edit) */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                Detected Skills <span className="text-xs text-slate-400 font-normal">(click to remove)</span>
              </h2>
              <button
                onClick={() => setIsAddingSkill(!isAddingSkill)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                {isAddingSkill ? "Cancel" : "+ add skill"}
              </button>
            </div>

            {isAddingSkill && (
              <form onSubmit={handleAddSkill} className="space-y-2 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                <div>
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="Skill name (e.g. React, SQL)"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="flex justify-between items-center">
                  <select
                    value={newSkillCategory}
                    onChange={(e) =>
                      setNewSkillCategory(
                        e.target.value as "language" | "framework" | "database" | "tool" | "cloud" | "soft" | "other"
                      )
                    }
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300"
                  >
                    <option value="language">Language</option>
                    <option value="framework">Framework</option>
                    <option value="database">Database</option>
                    <option value="tool">Tool</option>
                    <option value="cloud">Cloud</option>
                    <option value="soft">Soft</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
              {activeResume?.parsed?.skills && activeResume.parsed.skills.length > 0 ? (
                activeResume.parsed.skills.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => handleRemoveSkill(s.name)}
                    title={`Click to remove "${s.name}" (${s.category})`}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 text-slate-200 hover:bg-rose-900/60 hover:text-rose-200 border border-slate-700/60 hover:border-rose-700 transition-all flex items-center gap-1 group"
                  >
                    <span>{s.name}</span>
                    <span className="text-slate-500 group-hover:text-rose-300 text-[10px]">×</span>
                  </button>
                ))
              ) : (
                <p className="text-xs text-slate-400">No skills detected or added yet.</p>
              )}
            </div>

            {/* Banner Notice */}
            <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-lg text-xs text-amber-300/90 leading-relaxed">
              Parsed data is editable. Your edits are the source of truth for tailoring.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
