import { daysBetween } from "../dates";
import type { SegmentKey } from "./segments";

export type ChannelKey = "sms" | "email";

export interface ContactFlags {
  email: string | null;
  mobile: string | null;
  smsOptIn: boolean;
  smsOptOut: boolean;
  emailOptOut: boolean;
  doNotContact: boolean;
}

export interface PriorMessage {
  segment: SegmentKey;
  status: "drafted" | "approved" | "rejected" | "sent" | "failed";
  sentAt: Date | null;
}

export type SkipReason =
  | "do_not_contact"
  | "no_permitted_channel"
  | "already_messaged_for_segment"
  | "messaged_in_last_30_days";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  do_not_contact: "Flagged do not contact",
  no_permitted_channel: "No permitted channel (no text opt-in, opted out, or no email)",
  already_messaged_for_segment: "Already messaged (or pending) for this segment",
  messaged_in_last_30_days: "Sent a message in the last 30 days",
};

export const RECENT_CONTACT_DAYS = 30;

export function canText(p: ContactFlags): boolean {
  return !p.doNotContact && p.smsOptIn && !p.smsOptOut && !!p.mobile;
}

export function canEmail(p: ContactFlags): boolean {
  return !p.doNotContact && !p.emailOptOut && !!p.email;
}

/** Text if the patient has opted in to texts (and not opted out), otherwise email. */
export function chooseChannel(p: ContactFlags): ChannelKey | null {
  if (canText(p)) return "sms";
  if (canEmail(p)) return "email";
  return null;
}

export type Eligibility = { eligible: true; channel: ChannelKey } | { eligible: false; reason: SkipReason };

/**
 * The never-contact rules. A patient is drafted a message only if this returns eligible.
 * `history` must include every message ever created for the patient.
 */
export function checkEligibility(
  patient: ContactFlags,
  segment: SegmentKey,
  history: PriorMessage[],
  now: Date,
): Eligibility {
  if (patient.doNotContact) return { eligible: false, reason: "do_not_contact" };

  // Already received (or has a pending draft/approval) for the same segment.
  if (history.some((m) => m.segment === segment && m.status !== "rejected" && m.status !== "failed")) {
    return { eligible: false, reason: "already_messaged_for_segment" };
  }

  // Anyone sent any message in the last 30 days.
  if (history.some((m) => m.status === "sent" && m.sentAt && daysBetween(m.sentAt, now) < RECENT_CONTACT_DAYS)) {
    return { eligible: false, reason: "messaged_in_last_30_days" };
  }

  const channel = chooseChannel(patient);
  if (!channel) return { eligible: false, reason: "no_permitted_channel" };
  return { eligible: true, channel };
}
