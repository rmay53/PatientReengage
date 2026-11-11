import { KeywordReplyClassifier } from "./keyword";
import type { ReplyClassifier } from "./types";

export type { ReplyClassifier, Classification, ReplyContext, ReplyCategoryKey } from "./types";

/** Swap this for an AI-backed implementation later. */
export function getReplyClassifier(): ReplyClassifier {
  return new KeywordReplyClassifier();
}
