// apps/web/src/api/useDocuments.ts - typed React Query hooks for Phase 5 documents
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export interface GuardReport {
  ok: boolean;
  violations: string[];
}

export interface TailoredBullet {
  sourceBulletId: string;
  text: string;
}

export interface TailoredSection {
  kind: "experience" | "project";
  sourceId: string;
  bullets: TailoredBullet[];
}

export interface TailoredResumeContent {
  summary: string;
  skills: string[];
  sections: TailoredSection[];
}

export interface CoverLetterContent {
  greeting: string;
  paragraphs: string[];
  closing: string;
  factsUsed: string[];
}

export type DocKind = "TAILORED_RESUME" | "COVER_LETTER" | "ANSWER_SET";
export type DocFormat = "JSON" | "PDF" | "DOCX" | "MD";

export interface GeneratedDocument {
  id: string;
  profileId: string;
  jobId: string | null;
  kind: DocKind;
  format: DocFormat;
  content: TailoredResumeContent | CoverLetterContent | Record<string, unknown>;
  filePath: string | null;
  model: string;
  promptVersion: string;
  guardReport: GuardReport;
  approvedAt: string | null;
  createdAt: string;
}

export interface GenerateDocumentsResult {
  resumeDocument: GeneratedDocument;
  coverLetterDocument: GeneratedDocument | null;
  guardReport: GuardReport;
  llmAttempts: number;
}

// POST /api/v1/jobs/:jobId/documents
export function useGenerateDocuments(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient<{ data: GenerateDocumentsResult }>(`/jobs/${jobId}/documents`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", jobId] });
    },
  });
}

// GET /api/v1/documents/:id
export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => apiClient<{ data: GeneratedDocument }>(`/documents/${id}`),
    enabled: Boolean(id),
  });
}

// PATCH /api/v1/documents/:id  (editing clears approvedAt)
export function usePatchDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: Record<string, unknown>) =>
      apiClient<{ data: GeneratedDocument }>(`/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", id] });
    },
  });
}

// POST /api/v1/documents/:id/approve
export function useApproveDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient<{ data: GeneratedDocument }>(`/documents/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", id] });
    },
  });
}

// POST /api/v1/documents/:id/export?format=pdf|docx
export function useExportDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (format: "pdf" | "docx") =>
      apiClient<{ data: GeneratedDocument }>(`/documents/${id}/export?format=${format}`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", id] });
    },
  });
}

// Helper: open the file download URL in a new tab
export function openDocumentFile(id: string) {
  const token = localStorage.getItem("jobpilot_token") ?? "";
  // Uses a link with the auth header approach via fetch + blob URL
  const BASE = "http://127.0.0.1:4000/api/v1";
  return fetch(`${BASE}/documents/${id}/file`, {
    headers: { "x-jobpilot-token": token },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume.${res.headers.get("content-type")?.includes("pdf") ? "pdf" : "docx"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
