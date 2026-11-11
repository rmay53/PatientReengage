"use server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth/session";
import { approveSuggestedReply, markReplyHandled, receiveReply } from "@/services/replies";
import { searchPatients } from "@/services/patients";
import { run } from "./util";

export async function testReplyAction(patientId: string, text: string, channel: "" | "sms" | "email") {
  const result = await run("test_reply", async () => {
    const r = await receiveReply(await requireAction("handle_inbox"), patientId, text, channel || undefined);
    return { category: r.category, urgent: r.urgent, optOut: r.optOut, suggestedReply: r.suggestedReply };
  });
  revalidatePath("/inbox");
  return result;
}

export async function findPatientsAction(q: string) {
  return run("find_patients", async () => {
    const { items } = await searchPatients(await requireAction("handle_inbox"), q, { take: 15 });
    return items.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName} (${p.externalId}) - ${p.location.name}` }));
  });
}

export async function approveSuggestedAction(replyId: string, text: string) {
  const result = await run("approve_suggested", async () => approveSuggestedReply(await requireAction("handle_inbox"), replyId, text));
  revalidatePath("/inbox");
  return result;
}

export async function markHandledAction(replyId: string) {
  const result = await run("mark_handled", async () => markReplyHandled(await requireAction("handle_inbox"), replyId));
  revalidatePath("/inbox");
  return result;
}
