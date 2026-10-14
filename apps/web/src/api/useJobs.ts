// apps/web/src/api/useJobs.ts - typed data hook (TanStack Query)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export type UserJobState = "NEW" | "SAVED" | "HIDDEN" | "APPLIED";

export interface JobMatchBreakdown {
  skills: number;
  semantic: number;
  title: number;
  experience: number;
  location: number;
}

export interface JobMatchItem {
  id: string;
  jobId: string;
  profileId: string;
  score: number;
  breakdown: JobMatchBreakdown;
  matchedSkills: string[];
  missingSkills: string[];
  llmAdjustment: number;
  explanation: string | null;
  userState: UserJobState;
  createdAt: string;
  updatedAt: string;
}

export interface JobRow {
  id: string;
  jobId: string;
  score: number;
  userState: UserJobState;
  breakdown: JobMatchBreakdown;
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string | null;
  llmAdjustment: number;
  job: {
    id: string;
    title: string;
    location: string | null;
    workMode: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
    seniority: "INTERN" | "FRESHER" | "JUNIOR" | "MID" | "SENIOR" | "UNKNOWN";
    minYears: number | null;
    maxYears: number | null;
    applyUrl: string;
    company: { name: string };
    source?: { name: string; kind: string };
  };
}

export interface JobDetail {
  id: string;
  title: string;
  normalizedTitle: string;
  location: string | null;
  workMode: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
  seniority: "INTERN" | "FRESHER" | "JUNIOR" | "MID" | "SENIOR" | "UNKNOWN";
  minYears: number | null;
  maxYears: number | null;
  applyUrl: string;
  canonicalUrl: string;
  descriptionText: string;
  company: { id: string; name: string };
  source?: { id: string; name: string; kind: string };
  skills: { required: boolean; skill: { id: string; name: string; display: string } }[];
  matches: JobMatchItem[];
}

export interface JobFilterParams {
  minScore?: number;
  state?: UserJobState;
  q?: string;
  remote?: boolean;
  source?: string;
  cursor?: string;
  limit?: number;
}

export function useJobs(filters: JobFilterParams = {}) {
  const params = new URLSearchParams();
  if (filters.minScore !== undefined) params.set("minScore", String(filters.minScore));
  if (filters.state) params.set("state", filters.state);
  if (filters.q) params.set("q", filters.q);
  if (filters.remote !== undefined) params.set("remote", String(filters.remote));
  if (filters.source) params.set("source", filters.source);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));

  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery({
    queryKey: ["jobs", filters],
    queryFn: () => apiClient<{ data: JobRow[]; nextCursor: string | null }>(`/jobs${qs}`),
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => apiClient<{ data: JobDetail }>(`/jobs/${id}`),
    enabled: Boolean(id),
  });
}

export function useSetJobState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; state: UserJobState }) =>
      apiClient<{ data: JobMatchItem }>(`/jobs/${v.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ state: v.state }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job"] });
    },
  });
}

export function useRescoreJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      apiClient<{ data: JobMatchItem }>(`/jobs/${jobId}/rescore`, {
        method: "POST",
      }),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

export function useImportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      company: string;
      location?: string;
      descriptionText: string;
      url?: string;
    }) =>
      apiClient<{ jobId: string; duplicateOf: string | null; matchQueued: boolean }>("/jobs/import", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
