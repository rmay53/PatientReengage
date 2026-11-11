export type ReplyCategoryKey = "opt_out" | "booking" | "clinical" | "other";

/** Non-clinical values the classifier may use when suggesting a response. */
export interface ReplyContext {
  firstName: string;
  locationName: string;
  locationPhone: string;
  bookingLink: string;
}

export interface Classification {
  category: ReplyCategoryKey;
  /** True when the reply contains any opt-out request. Always honoured, whatever the category. */
  optOut: boolean;
  /** Clinical replies are marked urgent for staff. */
  urgent: boolean;
  /** Only for booking replies. Never sent without staff approval. */
  suggestedReply: string | null;
}

/**
 * The single seam between the app and reply sorting. The prototype uses keyword
 * rules; an AI model can implement this interface later without other changes.
 * Implementations must prefer "clinical" or "other" over any automatic answer
 * when unsure.
 */
export interface ReplyClassifier {
  classify(text: string, context: ReplyContext): Promise<Classification>;
}
