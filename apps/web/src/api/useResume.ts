// apps/web/src/api/useResume.ts - TanStack Query hooks for Resumes & ATS Analysis
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";
import type { ParsedResume } from "@jobpilot/shared";

export interface ResumeRow {
  id: string;
  profileId: string;
  label: string;
  originalName: string;
  mimeType: string;
  sha256: string;
  rawText: string;
  parsed: ParsedResume | null;
  parseStatus: "PENDING" | "PARSED" | "NEEDS_REVIEW" | "FAILED";
  parserModel: string | null;
  isPrimary: boolean;
  createdAt: string;
  analyses?: ResumeAnalysisRow[];
}

export interface ResumeAnalysisRow {
  id: string;
  resumeId: string;
  atsScore: number;
  sectionScores: {
    contact?: number;
    summary?: number;
    skills?: number;
    experience?: number;
    education?: number;
    formatting?: number;
  };
  strengths: string[];
  weaknesses: string[];
  suggestions: {
    section: string;
    issue: string;
    fix: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
  }[];
  model: string;
  createdAt: string;
}

export function useResumes() {
  return useQuery({
    queryKey: ["resumes"],
    queryFn: () => apiClient<{ data: ResumeRow[] }>("/resumes"),
  });
}

export function useResume(id: string | null) {
  return useQuery({
    queryKey: ["resume", id],
    queryFn: () => apiClient<{ data: ResumeRow }>(`/resumes/${id}`),
    enabled: Boolean(id),
  });
}

export function useResumeAnalysis(id: string | null) {
  return useQuery({
    queryKey: ["resumeAnalysis", id],
    queryFn: () => apiClient<{ data: ResumeAnalysisRow }>(`/resumes/${id}/analysis`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiClient<{ data: ResumeRow; isDuplicate?: boolean }>("/resumes", {
        method: "POST",
        body: formData,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
  });
}

export function useUpdateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parsed }: { id: string; parsed: ParsedResume }) =>
      apiClient<{ data: ResumeRow }>(`/resumes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(parsed),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      qc.invalidateQueries({ queryKey: ["resume", vars.id] });
    },
  });
}

export function useAnalyzeResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ data: ResumeAnalysisRow }>(`/resumes/${id}/analyze`, {
        method: "POST",
      }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["resumeAnalysis", id] });
      qc.invalidateQueries({ queryKey: ["resume", id] });
    },
  });
}

export function useSetPrimaryResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ success: boolean; data: ResumeRow }>(`/resumes/${id}/primary`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
  });
}
