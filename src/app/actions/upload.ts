"use server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth/session";
import { commitImport, previewImport } from "@/services/imports";
import { run } from "./util";

export async function previewUploadAction(text: string) {
  return run("upload_preview", async () => {
    const actor = await requireAction("upload");
    const result = await previewImport(actor, text);
    if (!result.ok) return { fatal: result.fatal };
    return {
      accepted: result.accepted.map((r) => ({
        rowNumber: r.rowNumber,
        externalId: r.externalId,
        name: `${r.firstName} ${r.lastName}`,
        location: r.locationName,
        therapist: r.therapistName,
        dischargeDate: r.dischargeDate.toISOString().slice(0, 10),
        dischargeType: r.dischargeType,
        hasEmail: !!r.email,
        hasMobile: !!r.mobile,
        smsOptIn: r.smsOptIn,
        isUpdate: r.isUpdate,
      })),
      rejected: result.rejected,
    };
  });
}

export async function commitUploadAction(fileName: string, text: string) {
  const result = await run("upload_commit", async () => commitImport(await requireAction("upload"), fileName, text));
  revalidatePath("/segments");
  return result;
}
