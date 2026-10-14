// packages/core/src/applications/transitions.ts
// State machine transitions for job applications according to Blueprint Fig 5.8
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

/**
 * Transitions permitted by the Fig 5.8 state machine:
 * PLANNED      -> PREPARED, WITHDRAWN
 * PREPARED     -> SUBMITTED, WITHDRAWN
 * SUBMITTED    -> ACKNOWLEDGED, GHOSTED (21 days), WITHDRAWN
 * ACKNOWLEDGED -> SCREENING, GHOSTED, WITHDRAWN
 * SCREENING    -> ASSESSMENT, INTERVIEW, REJECTED, WITHDRAWN
 * ASSESSMENT   -> INTERVIEW, REJECTED, WITHDRAWN
 * INTERVIEW    -> OFFER, REJECTED, WITHDRAWN
 * Terminal: OFFER, REJECTED, WITHDRAWN, GHOSTED
 */
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PLANNED: ["PREPARED", "WITHDRAWN"],
  PREPARED: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["ACKNOWLEDGED", "GHOSTED", "WITHDRAWN"],
  ACKNOWLEDGED: ["SCREENING", "GHOSTED", "WITHDRAWN"],
  SCREENING: ["ASSESSMENT", "INTERVIEW", "REJECTED", "WITHDRAWN"],
  ASSESSMENT: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: [],
  REJECTED: [],
  WITHDRAWN: [],
  GHOSTED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Default followUpAt dates:
 * - SUBMITTED: 7 days
 * - ACKNOWLEDGED: 14 days
 * - SCREENING / ASSESSMENT / INTERVIEW: 7 days
 * - Terminal states: null
 */
export function calculateDefaultFollowUpAt(
  toStatus: ApplicationStatus,
  baseDate: Date = new Date(),
): Date | null {
  const d = new Date(baseDate);
  switch (toStatus) {
    case "SUBMITTED":
      d.setDate(d.getDate() + 7);
      return d;
    case "ACKNOWLEDGED":
      d.setDate(d.getDate() + 14);
      return d;
    case "SCREENING":
    case "ASSESSMENT":
    case "INTERVIEW":
    case "PLANNED":
    case "PREPARED":
      d.setDate(d.getDate() + 7);
      return d;
    case "OFFER":
    case "REJECTED":
    case "WITHDRAWN":
    case "GHOSTED":
      return null;
    default:
      return null;
  }
}

/**
 * Fig 5.8: SUBMITTED or ACKNOWLEDGED transitions to GHOSTED if no reply in 21 days.
 */
export function isGhostedEligible(
  status: ApplicationStatus,
  lastActivityDate: Date,
  now: Date = new Date(),
): boolean {
  if (status !== "SUBMITTED" && status !== "ACKNOWLEDGED") return false;
  const diffDays = (now.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 21;
}
