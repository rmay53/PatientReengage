export interface OutboundSms {
  to: string;
  body: string;
  messageId?: string;
  replyId?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  replyId?: string;
}

export interface SendResult {
  providerRef: string;
}

/** Real implementation (e.g. Twilio) added later. */
export interface SmsSender {
  send(msg: OutboundSms): Promise<SendResult>;
}

/** Real implementation (e.g. SES, Postmark) added later. */
export interface EmailSender {
  send(msg: OutboundEmail): Promise<SendResult>;
}
