"use server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth/session";
import { draftSegment } from "@/services/drafting";
import { approveMany, approveMessage, rejectMessage } from "@/services/messages";
import { asSegment } from "@/lib/labels";
import { ValidationError } from "@/lib/auth/permissions";
import { run } from "./util";

export async function draftSegmentAction(segment: string, locationId: string | null) {
  const result = await run("draft", async () => {
    const seg = asSegment(segment);
    if (!seg) throw new ValidationError("Unknown segment.");
    return draftSegment(await requireAction("draft"), seg, locationId || null);
  });
  revalidatePath("/segments");
  revalidatePath("/queue");
  return result;
}

export async function approveAction(messageId: string, edits?: { subject?: string | null; body: string }) {
  const result = await run("approve", async () => approveMessage(await requireAction("approve"), messageId, edits));
  revalidatePath("/queue");
  revalidatePath("/outbox");
  return result;
}

export async function rejectAction(messageId: string) {
  const result = await run("reject", async () => rejectMessage(await requireAction("approve"), messageId));
  revalidatePath("/queue");
  return result;
}

export async function approveManyAction(messageIds: string[]) {
  const result = await run("approve_many", async () => {
    if (messageIds.length > 500) throw new ValidationError("Select 500 or fewer messages at a time.");
    return approveMany(await requireAction("approve"), messageIds);
  });
  revalidatePath("/queue");
  revalidatePath("/outbox");
  return result;
}
