import { prisma } from "../db";
import type { EmailSender, OutboundEmail, OutboundSms, SendResult, SmsSender } from "./types";

/** Writes to simulated_deliveries instead of sending anything. */
export class FakeSmsSender implements SmsSender {
  async send(msg: OutboundSms): Promise<SendResult> {
    if (process.env.FAKE_SEND_FAIL === "sms") throw Object.assign(new Error("Simulated failure"), { code: "FAKE_FAIL" });
    const row = await prisma.simulatedDelivery.create({
      data: { channel: "sms", toAddress: msg.to, body: msg.body, messageId: msg.messageId, replyId: msg.replyId },
    });
    return { providerRef: `fake-sms-${row.id}` };
  }
}

export class FakeEmailSender implements EmailSender {
  async send(msg: OutboundEmail): Promise<SendResult> {
    if (process.env.FAKE_SEND_FAIL === "email") throw Object.assign(new Error("Simulated failure"), { code: "FAKE_FAIL" });
    const row = await prisma.simulatedDelivery.create({
      data: {
        channel: "email",
        toAddress: msg.to,
        subject: msg.subject,
        body: msg.body,
        messageId: msg.messageId,
        replyId: msg.replyId,
      },
    });
    return { providerRef: `fake-email-${row.id}` };
  }
}
