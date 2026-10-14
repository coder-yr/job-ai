// packages/core/src/notifications/desktop.ts - Optional desktop notifications via node-notifier
import notifier from "node-notifier";

export interface DesktopNotificationOptions {
  title: string;
  message: string;
  sound?: boolean;
}

export function notifyDesktop(options: DesktopNotificationOptions): void {
  try {
    notifier.notify({
      title: options.title,
      message: options.message,
      sound: options.sound ?? true,
      appID: "JobPilot AI",
    });
  } catch (err) {
    console.warn("[desktop-notification] Desktop notification failed:", err);
  }
}
