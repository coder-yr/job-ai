// apps/web/src/api/useSchedule.ts - Schedule settings and Kill Switch API hooks
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export interface ScheduleConfig {
  hour: number;
  minute: number;
  timezone: string;
  catchUpEnabled: boolean;
  killSwitchEnabled: boolean;
}

export function useSchedule() {
  return useQuery({
    queryKey: ["scheduleSettings"],
    queryFn: () => apiClient<{ data: ScheduleConfig }>("/settings/schedule"),
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ScheduleConfig>) =>
      apiClient<{ data: ScheduleConfig; success: boolean }>("/settings/schedule", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduleSettings"] });
    },
  });
}

export function useToggleKillSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiClient<{ success: boolean; enabled: boolean }>("/settings/kill-switch", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduleSettings"] });
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });
}
