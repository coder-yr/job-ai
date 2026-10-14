// apps/web/src/api/useSources.ts - TanStack Query hooks for sources, search runs, and settings
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export interface SourceRow {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  minIntervalMin: number;
  termsNote: string | null;
  lastRunAt: string | null;
  _count?: { jobs: number };
}

export interface SearchRunRow {
  id: string;
  trigger: "SCHEDULED" | "MANUAL" | "CATCHUP";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: string | null;
  finishedAt: string | null;
  stats: {
    fetched?: number;
    new?: number;
    dupes?: number;
    filtered?: number;
    errors?: string[];
  };
  createdAt: string;
}

export function useSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: () => apiClient<{ data: SourceRow[] }>("/sources"),
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SourceRow>) =>
      apiClient<{ data: SourceRow }>("/sources", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<SourceRow>) =>
      apiClient<{ data: SourceRow }>(`/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient<void>(`/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useSearchRuns() {
  return useQuery({
    queryKey: ["searchRuns"],
    queryFn: () => apiClient<{ data: SearchRunRow[] }>("/search-runs"),
  });
}

export function useTriggerSearchRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient<{ message: string; trigger: string }>("/search-runs", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["searchRuns"] }),
  });
}
