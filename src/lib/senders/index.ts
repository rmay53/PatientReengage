import { FakeEmailSender, FakeSmsSender } from "./fake";
import type { EmailSender, SmsSender } from "./types";

export type { SmsSender, EmailSender } from "./types";

/** The prototype only ships fake senders. Real providers plug in here later. */
export function getSmsSender(): SmsSender {
  return new FakeSmsSender();
}

export function getEmailSender(): EmailSender {
  return new FakeEmailSender();
}
