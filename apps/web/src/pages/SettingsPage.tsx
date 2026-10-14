// apps/web/src/pages/SettingsPage.tsx - Sources, schedule, mailbox, and privacy per wireframe 10.7
import React, { useState } from "react";
import {
  useSources,
  useCreateSource,
  useUpdateSource,
  useDeleteSource,
  useSearchRuns,
  useTriggerSearchRun,
} from "../api/useSources.js";
import {
  useSchedule,
  useUpdateSchedule,
  useToggleKillSwitch,
} from "../api/useSchedule.js";
import {
  useAssistCap,
  useUpdateAssistCap,
} from "../api/useApplications.js";

export function SettingsPage() {
  const { data: sourcesRes, isLoading: isLoadingSources } = useSources();
  const sources = sourcesRes?.data || [];

  const { data: searchRunsRes } = useSearchRuns();
  const searchRuns = searchRunsRes?.data || [];

  const { data: schedRes } = useSchedule();
  const scheduleConfig = schedRes?.data;

  const updateScheduleMutation = useUpdateSchedule();
  const toggleKillSwitchMutation = useToggleKillSwitch();

  const [schedHour, setSchedHour] = useState<number | null>(null);
  const [schedMinute, setSchedMinute] = useState<number | null>(null);
  const [schedTz, setSchedTz] = useState<string | null>(null);
  const [schedCatchUp, setSchedCatchUp] = useState<boolean | null>(null);
  const [saveSchedSuccess, setSaveSchedSuccess] = useState(false);

  const { data: assistCapRes } = useAssistCap();
  const updateAssistCapMutation = useUpdateAssistCap();
  const [dailyCap, setDailyCap] = useState<number | null>(null);
  const [saveCapSuccess, setSaveCapSuccess] = useState(false);

  const createSourceMutation = useCreateSource();
  const updateSourceMutation = useUpdateSource();
  const deleteSourceMutation = useDeleteSource();
  const triggerRunMutation = useTriggerSearchRun();

  // New source form state
  const [showAddSource, setShowAddSource] = useState(false);
  const [newKind, setNewKind] = useState("ATS_GREENHOUSE");
  const [newName, setNewName] = useState("");
  const [newConfigParam, setNewConfigParam] = useState("");
  const [newTermsNote, setNewTermsNote] = useState("");

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    let config: Record<string, unknown> = {};
    if (newKind === "ATS_GREENHOUSE") {
      config = { boardToken: newConfigParam.trim() };
    } else if (newKind === "ATS_LEVER") {
      config = { site: newConfigParam.trim() };
    } else if (newKind === "ATS_ASHBY") {
      config = { boardName: newConfigParam.trim() };
    } else if (newKind === "ATS_SMARTRECRUITERS") {
      config = { companyIdentifier: newConfigParam.trim() };
    } else if (newKind === "CAREER_PAGE_JSONLD") {
      config = { url: newConfigParam.trim() };
    }

    await createSourceMutation.mutateAsync({
      kind: newKind,
      name: newName.trim(),
      config,
      termsNote: newTermsNote.trim() || "Permitted public endpoint",
      enabled: true,
      minIntervalMin: 360,
    });

    setNewName("");
    setNewConfigParam("");
    setNewTermsNote("");
    setShowAddSource(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Sources, schedule and privacy</h1>
          <p className="text-sm text-slate-400">
            Control automated discovery channels, platform compliance, execution schedules, and local secrets.
          </p>
        </div>
        <button
          onClick={() => triggerRunMutation.mutate()}
          disabled={triggerRunMutation.isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm shadow-sm transition-all"
        >
          {triggerRunMutation.isPending ? "Running discovery..." : "Run search now"}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Job Sources & Run History */}
        <div className="lg:col-span-2 space-y-8">
          {/* Job Sources Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Job sources</h2>
                <p className="text-xs text-slate-400">Only permitted, official and unauthenticated channels are accessed.</p>
              </div>
              <button
                onClick={() => setShowAddSource(!showAddSource)}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
              >
                {showAddSource ? "Cancel" : "+ Add source"}
              </button>
            </div>

            {/* Add Source Form */}
            {showAddSource && (
              <form onSubmit={handleCreateSource} className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Source Kind</label>
                    <select
                      value={newKind}
                      onChange={(e) => setNewKind(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                    >
                      <option value="ATS_GREENHOUSE">Greenhouse (Public API)</option>
                      <option value="ATS_LEVER">Lever (Public API)</option>
                      <option value="ATS_ASHBY">Ashby (Public API)</option>
                      <option value="ATS_SMARTRECRUITERS">SmartRecruiters (Public API)</option>
                      <option value="CAREER_PAGE_JSONLD">Careers Page (JSON-LD + robots.txt)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Friendly Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Acme Labs Greenhouse"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    {newKind === "CAREER_PAGE_JSONLD" ? "URL (must obey robots.txt)" : "Board Token / Identifier"}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      newKind === "CAREER_PAGE_JSONLD"
                        ? "https://careers.example.com/jobs"
                        : "e.g. acme (from boards.greenhouse.io/acme)"
                    }
                    value={newConfigParam}
                    onChange={(e) => setNewConfigParam(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Legal basis / Terms Note</label>
                  <input
                    type="text"
                    placeholder="Public Job Board API, GET only, reviewed 2026-10"
                    value={newTermsNote}
                    onChange={(e) => setNewTermsNote(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium"
                >
                  Save Source
                </button>
              </form>
            )}

            {/* Sources Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 font-medium">Source</th>
                    <th className="py-2.5 font-medium">Method</th>
                    <th className="py-2.5 font-medium">Legal Basis / Notes</th>
                    <th className="py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sources.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/20">
                      <td className="py-2.5 font-medium text-white">{s.name}</td>
                      <td className="py-2.5 text-slate-400">
                        {s.kind.startsWith("ATS_") ? "Public API" : s.kind === "CAREER_PAGE_JSONLD" ? "JSON-LD + robots.txt" : s.kind}
                      </td>
                      <td className="py-2.5 text-slate-400 italic max-w-xs truncate">{s.termsNote || "Official read-only feed"}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => updateSourceMutation.mutate({ id: s.id, enabled: !s.enabled })}
                          className={`w-9 h-5 inline-flex items-center rounded-full transition-colors ${
                            s.enabled ? "bg-indigo-600" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 bg-white rounded-full transition-transform transform ${
                              s.enabled ? "translate-x-4.5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* LinkedIn / Indeed / Naukri row */}
                  <tr className="hover:bg-slate-800/20">
                    <td className="py-2.5 font-medium text-white">LinkedIn / Indeed / Naukri</td>
                    <td className="py-2.5 text-slate-400">E-mail alerts only</td>
                    <td className="py-2.5 text-slate-400 italic">User-configured job alert emails</td>
                    <td className="py-2.5 text-right">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">
                        Enabled
                      </span>
                    </td>
                  </tr>

                  {/* Portal Scraping Row: NEVER ALLOWED, DISABLED & GRAYED OUT */}
                  <tr className="bg-slate-950/40 text-slate-500 opacity-60 cursor-not-allowed">
                    <td className="py-2.5 font-medium">Portal scraping</td>
                    <td className="py-2.5">Not supported (ToS)</td>
                    <td className="py-2.5 italic">Forbidden by design (Chapter 2)</td>
                    <td className="py-2.5 text-right">
                      <button
                        disabled
                        title="Portal scraping is forbidden by platform rules and cannot be enabled"
                        className="w-9 h-5 inline-flex items-center rounded-full bg-slate-800 cursor-not-allowed"
                      >
                        <span className="w-3.5 h-3.5 bg-slate-600 rounded-full translate-x-0.5" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Discovery Run History Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-white">Run History</h2>
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 font-medium">Trigger</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Fetched</th>
                    <th className="py-2 font-medium">New</th>
                    <th className="py-2 font-medium">Duplicates</th>
                    <th className="py-2 font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {searchRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-800/20">
                      <td className="py-2 text-slate-300">{run.trigger}</td>
                      <td className="py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            run.status === "SUCCEEDED"
                              ? "bg-emerald-900/50 text-emerald-300"
                              : run.status === "PARTIAL"
                              ? "bg-amber-900/50 text-amber-300"
                              : run.status === "RUNNING"
                              ? "bg-blue-900/50 text-blue-300 animate-pulse"
                              : "bg-rose-900/50 text-rose-300"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2">{run.stats?.fetched ?? 0}</td>
                      <td className="py-2 font-semibold text-emerald-400">{run.stats?.new ?? 0}</td>
                      <td className="py-2 text-slate-400">{run.stats?.dupes ?? 0}</td>
                      <td className="py-2 text-rose-400">{run.stats?.errors?.length ?? 0}</td>
                    </tr>
                  ))}
                  {searchRuns.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-500">
                        No discovery runs executed yet. Click &quot;Run search now&quot; to fetch jobs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Col: Schedule, Local AI, Mailbox, Privacy */}
        <div className="space-y-6">
          {/* Emergency Kill Switch Card */}
          <div className={`border rounded-xl p-5 shadow-sm space-y-3 transition-colors ${
            scheduleConfig?.killSwitchEnabled
              ? "bg-rose-950/40 border-rose-600/80"
              : "bg-slate-900/80 border-slate-800"
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <span>Outbound Kill Switch</span>
                  {scheduleConfig?.killSwitchEnabled && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white animate-pulse">
                      ACTIVE
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Emergency stop for all automated and manual outbound HTTP traffic across all sources.
                </p>
              </div>
              <button
                onClick={() => toggleKillSwitchMutation.mutate(!scheduleConfig?.killSwitchEnabled)}
                disabled={toggleKillSwitchMutation.isPending}
                className={`w-11 h-6 inline-flex items-center rounded-full transition-colors shrink-0 ${
                  scheduleConfig?.killSwitchEnabled ? "bg-rose-600" : "bg-slate-700"
                }`}
                title={scheduleConfig?.killSwitchEnabled ? "Click to deactivate kill switch" : "Click to activate kill switch"}
              >
                <span
                  className={`w-4 h-4 bg-white rounded-full transition-transform transform ${
                    scheduleConfig?.killSwitchEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {scheduleConfig?.killSwitchEnabled && (
              <div className="p-3 bg-rose-900/30 border border-rose-800/50 rounded-lg text-rose-200 text-xs">
                ⚠️ Outbound fetching is completely disabled. All scheduled, catch-up, and manual runs will not make any external network requests.
              </div>
            )}
          </div>

          {/* Schedule Configuration Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Daily Schedule</h2>
                <p className="text-xs text-slate-400">Configure execution time, timezone, and missed-run catchup.</p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                Scheduled
              </span>
            </div>

            <div className="space-y-3 text-xs">
              {/* Daily Run Time */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">Search Time (HH:MM)</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400">Hour (0-23)</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={schedHour ?? scheduleConfig?.hour ?? 8}
                      onChange={(e) => setSchedHour(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">Minute (0-59)</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={schedMinute ?? scheduleConfig?.minute ?? 0}
                      onChange={(e) => setSchedMinute(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">Timezone</label>
                <input
                  type="text"
                  value={schedTz ?? scheduleConfig?.timezone ?? "Asia/Kolkata"}
                  onChange={(e) => setSchedTz(e.target.value)}
                  placeholder="e.g. Asia/Kolkata or America/New_York"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                />
              </div>

              {/* Catch-up toggle */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="block text-slate-200 font-medium">Catch-up if missed (&gt;20h)</span>
                  <span className="block text-[11px] text-slate-400">
                    Enqueues exactly one CATCHUP run on boot if laptop was sleeping
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSchedCatchUp(!(schedCatchUp ?? scheduleConfig?.catchUpEnabled ?? true))}
                  className={`w-9 h-5 inline-flex items-center rounded-full transition-colors ${
                    (schedCatchUp ?? scheduleConfig?.catchUpEnabled ?? true) ? "bg-indigo-600" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 bg-white rounded-full transition-transform transform ${
                      (schedCatchUp ?? scheduleConfig?.catchUpEnabled ?? true) ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Kill Switch for all outbound sources */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="block text-slate-200 font-medium">Outbound Kill Switch</span>
                    {scheduleConfig?.killSwitchEnabled && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="block text-[11px] text-slate-400">
                    Immediately halts all outbound scraping and discovery across all sources
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleKillSwitchMutation.mutate(!scheduleConfig?.killSwitchEnabled)}
                  disabled={toggleKillSwitchMutation.isPending}
                  className={`w-9 h-5 inline-flex items-center rounded-full transition-colors ${
                    scheduleConfig?.killSwitchEnabled ? "bg-rose-600" : "bg-slate-700"
                  }`}
                  title={scheduleConfig?.killSwitchEnabled ? "Deactivate kill switch" : "Activate kill switch to stop all fetching"}
                >
                  <span
                    className={`w-3.5 h-3.5 bg-white rounded-full transition-transform transform ${
                      scheduleConfig?.killSwitchEnabled ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Save Button */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={async () => {
                    await updateScheduleMutation.mutateAsync({
                      hour: schedHour ?? scheduleConfig?.hour ?? 8,
                      minute: schedMinute ?? scheduleConfig?.minute ?? 0,
                      timezone: schedTz ?? scheduleConfig?.timezone ?? "Asia/Kolkata",
                      catchUpEnabled: schedCatchUp ?? scheduleConfig?.catchUpEnabled ?? true,
                    });
                    setSaveSchedSuccess(true);
                    setTimeout(() => setSaveSchedSuccess(false), 3000);
                  }}
                  disabled={updateScheduleMutation.isPending}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded font-medium transition-all"
                >
                  {updateScheduleMutation.isPending ? "Saving..." : "Save Schedule"}
                </button>
                {saveSchedSuccess && (
                  <span className="text-emerald-400 text-xs font-semibold">Saved successfully!</span>
                )}
              </div>
            </div>
          </div>

          {/* Assisted Apply Daily Cap Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Assisted Apply Daily Cap</h2>
                <p className="text-xs text-slate-400">
                  Rate-limits automated form pre-fills to avoid accidental over-application.
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-400 border border-indigo-800">
                Safe Limit
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Max assisted fills per day</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={dailyCap ?? assistCapRes?.data?.dailyCap ?? 10}
                    onChange={(e) => setDailyCap(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-24 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const val = dailyCap ?? assistCapRes?.data?.dailyCap ?? 10;
                      await updateAssistCapMutation.mutateAsync(val);
                      setSaveCapSuccess(true);
                      setTimeout(() => setSaveCapSuccess(false), 3000);
                    }}
                    disabled={updateAssistCapMutation.isPending}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded font-medium transition-all"
                  >
                    {updateAssistCapMutation.isPending ? "Saving..." : "Save Cap"}
                  </button>
                  {saveCapSuccess && (
                    <span className="text-emerald-400 text-xs font-semibold">Saved!</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Default: 10/day. Form is pre-filled in a visible browser and NEVER automatically submitted.
                </p>
              </div>
            </div>
          </div>

          {/* Local AI Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-white">Local AI (Ollama)</h2>
            <div className="space-y-1.5 text-xs text-slate-400">
              <p>Chat model: <span className="text-slate-200 font-mono">qwen2.5:7b-instruct</span></p>
              <p>Embedding model: <span className="text-slate-200 font-mono">nomic-embed-text</span></p>
              <p>Endpoint: <span className="text-slate-200 font-mono">http://127.0.0.1:11434</span></p>
            </div>
          </div>

          {/* Mailbox (read-only IMAP) Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-white">Mailbox (read-only IMAP)</h2>
            <p className="text-xs text-slate-400">
              Passwords are encrypted at rest with AES-256-GCM using your local passphrase.
            </p>
            <div className="space-y-2 text-xs">
              <input
                type="text"
                placeholder="imap.gmail.com"
                defaultValue="imap.gmail.com"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
              />
              <input
                type="email"
                placeholder="your.email@gmail.com"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
              />
              <input
                type="password"
                placeholder="App-specific password"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
              />
            </div>
          </div>

          {/* Privacy Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-white">Privacy &amp; Data Control</h2>
            <p className="text-xs text-slate-400">
              Your resume, jobs, and applications never leave your PC.
            </p>
            <div className="flex flex-col gap-2 pt-1 text-xs">
              <button
                onClick={() => alert("Creating database backup...")}
                className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-all"
              >
                Backup Now
              </button>
              <button
                onClick={() => alert("Exporting all personal data as JSON...")}
                className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-all"
              >
                Export All Data
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
