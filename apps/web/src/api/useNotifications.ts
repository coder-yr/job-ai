// apps/web/src/api/useNotifications.ts - Notifications API and SSE event subscription
import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  refType?: string | null;
  refId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  data: NotificationItem[];
  unreadCount: number;
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient<NotificationsResponse>("/notifications"),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ data: NotificationItem }>(`/notifications/${id}/read`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient<{ ok: boolean; count: number }>("/notifications/read-all", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// Hook to subscribe to real-time Server-Sent Events
export function useSseEvents(onMessage?: (type: string, data: unknown) => void) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("http://127.0.0.1:4000/api/v1/events");

    es.addEventListener("run.progress", (e) => {
      queryClient.invalidateQueries({ queryKey: ["searchRuns"] });
      try {
        const parsed = JSON.parse(e.data);
        onMessage?.("run.progress", parsed);
      } catch {}
    });

    es.addEventListener("matches.new", (e) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      try {
        const parsed = JSON.parse(e.data);
        onMessage?.("matches.new", parsed);
      } catch {}
    });

    es.addEventListener("document.ready", (e) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      try {
        const parsed = JSON.parse(e.data);
        onMessage?.("document.ready", parsed);
      } catch {}
    });

    es.addEventListener("notification.new", (e) => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      try {
        const parsed = JSON.parse(e.data);
        onMessage?.("notification.new", parsed);
      } catch {}
    });

    return () => {
      es.close();
    };
  }, [queryClient, onMessage]);
}
