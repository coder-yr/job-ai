// apps/web/src/api/useApplications.ts - Typed hooks for Applications and Tracker
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export type ApplicationStatus =
  | "PLANNED"
  | "PREPARED"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "SCREENING"
  | "INTERVIEW"
  | "ASSESSMENT"
  | "OFFER"
  | "REJECTED"
  | "WITHDRAWN"
  | "GHOSTED";

export interface ApplicationEventItem {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  source: string;
  note: string | null;
  occurredAt: string;
}

export interface ApplicationItem {
  id: string;
  profileId: string;
  jobId: string;
  status: ApplicationStatus;
  method: string;
  appliedAt: string | null;
  followUpAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  job: {
    id: string;
    title: string;
    applyUrl: string | null;
    location: string | null;
    workMode?: string;
    company: {
      name: string;
    };
  };
  events: ApplicationEventItem[];
  documents: Array<{
    id: string;
    kind: string;
    format: string;
    approvedAt: string | null;
    filePath: string | null;
  }>;
}

export interface EmailProposalItem {
  id: string;
  title: string;
  applicationId: string;
  company: string;
  roleTitle: string;
  proposedStatus: ApplicationStatus;
  confidence: number;
  category: string;
  nextStepDate: string | null;
  fromAddr: string;
  subject: string;
  createdAt: string;
}

export function useApplications(status?: string) {
  return useQuery<{ data: ApplicationItem[] }>({
    queryKey: ["applications", { status }],
    queryFn: () => apiClient(`/applications${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });
}

export function useApplication(id: string) {
  return useQuery<{ data: ApplicationItem }>({
    queryKey: ["application", id],
    queryFn: () => apiClient(`/applications/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      followUpAt,
      notes,
      note,
    }: {
      id: string;
      status?: ApplicationStatus;
      followUpAt?: string | null;
      notes?: string | null;
      note?: string;
    }) =>
      apiClient<{ data: ApplicationItem }>(`/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, followUpAt, notes, note }),
      }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["application", vars.id] });
    },
  });
}

export function useAssistApply() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ data: { ok: boolean; message: string; captchaDetected?: boolean } }>(
        `/applications/${id}/assist`,
        { method: "POST" },
      ),
  });
}

export function useProposals() {
  return useQuery<{ data: EmailProposalItem[] }>({
    queryKey: ["application-proposals"],
    queryFn: () => apiClient("/applications/proposals"),
    refetchInterval: 15000,
  });
}

export function useAcceptProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      apiClient<{ data: ApplicationItem }>(`/applications/proposals/${proposalId}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["application-proposals"] });
    },
  });
}

export function useDismissProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      apiClient<{ data: { dismissed: boolean } }>(`/applications/proposals/${proposalId}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["application-proposals"] });
    },
  });
}

export function useAssistCap() {
  return useQuery<{ data: { dailyCap: number } }>({
    queryKey: ["assist-cap"],
    queryFn: () => apiClient("/settings/assist-cap"),
  });
}

export function useUpdateAssistCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dailyCap: number) =>
      apiClient<{ data: { dailyCap: number } }>("/settings/assist-cap", {
        method: "PUT",
        body: JSON.stringify({ dailyCap }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assist-cap"] });
    },
  });
}

