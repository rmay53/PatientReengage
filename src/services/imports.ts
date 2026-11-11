import Papa from "papaparse";
import { prisma } from "../lib/db";
import { audit, auditMany } from "../lib/audit";
import { assertCan, locationScope, ValidationError, type Actor } from "../lib/auth/permissions";
import { validateCsv, type CsvResult } from "../lib/rules/csv";
import { log } from "../lib/log";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

async function buildContext(actor: Actor, text: string) {
  const [locations, therapists] = await Promise.all([
    prisma.location.findMany({ select: { id: true, name: true } }),
    prisma.therapist.findMany({ where: { active: true } }),
  ]);
  // Only look up the external ids that appear in the file.
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"),
  });
  const ids = parsed.data.map((r) => (r.external_id ?? "").trim()).filter(Boolean);
  const existing = await prisma.patient.findMany({
    where: { externalId: { in: ids } },
    select: { externalId: true, locationId: true },
  });
  return {
    locations,
    therapists,
    allowedLocationIds: locationScope(actor),
    existingPatientLocations: new Map(existing.map((e) => [e.externalId, e.locationId])),
    today: new Date(),
  };
}

function checkSize(text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_UPLOAD_BYTES) throw new ValidationError("File is larger than 2 MB.");
}

/** Validates without saving anything. */
export async function previewImport(actor: Actor, text: string): Promise<CsvResult> {
  assertCan(actor, "upload");
  checkSize(text);
  return validateCsv(text, await buildContext(actor, text));
}

export interface ImportSummary {
  batchId: string;
  created: number;
  updated: number;
  rejected: number;
}

/**
 * Imports the valid rows. Matching is by external_id: a known patient is updated,
 * never duplicated, and opt-out / do-not-contact flags are never touched by an upload.
 */
export async function commitImport(actor: Actor, fileName: string, text: string): Promise<ImportSummary> {
  assertCan(actor, "upload");
  checkSize(text);
  const result = validateCsv(text, await buildContext(actor, text));
  if (!result.ok) throw new ValidationError(result.fatal);
  if (result.accepted.length === 0) throw new ValidationError("No valid rows to import.");

  const safeName = fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "upload.csv";
  const summary = await prisma.$transaction(
    async (tx) => {
      let created = 0;
      let updated = 0;
      const entries: Parameters<typeof auditMany>[1] = [];
      const batch = await tx.importBatch.create({
        data: { uploadedBy: actor.id, fileName: safeName, rowsAccepted: result.accepted.length, rowsRejected: result.rejected.length },
      });
      for (const row of result.accepted) {
        const fields = {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          mobile: row.mobile,
          locationId: row.locationId,
          therapistId: row.therapistId,
          dischargeDate: row.dischargeDate,
          dischargeType: row.dischargeType,
          smsOptIn: row.smsOptIn,
        };
        const existing = await tx.patient.findUnique({ where: { externalId: row.externalId }, select: { id: true } });
        if (existing) {
          // Opt-out and do-not-contact flags are deliberately absent from `fields`.
          await tx.patient.update({ where: { id: existing.id }, data: fields });
          entries.push({ userId: actor.id, action: "patient.updated", entityType: "patient", entityId: existing.id, details: { batchId: batch.id } });
          updated++;
        } else {
          const p = await tx.patient.create({ data: { externalId: row.externalId, ...fields } });
          entries.push({ userId: actor.id, action: "patient.created", entityType: "patient", entityId: p.id, details: { batchId: batch.id } });
          created++;
        }
      }
      await audit(tx, {
        userId: actor.id,
        action: "import.uploaded",
        entityType: "import_batch",
        entityId: batch.id,
        details: { rowsAccepted: result.accepted.length, rowsRejected: result.rejected.length, created, updated },
      });
      await auditMany(tx, entries);
      return { batchId: batch.id, created, updated, rejected: result.rejected.length };
    },
    { timeout: 120_000 },
  );
  log.info("import.committed", { batchId: summary.batchId, userId: actor.id, createdCount: summary.created, updatedCount: summary.updated, rejectedCount: summary.rejected });
  return summary;
}

export async function recentImports(actor: Actor) {
  assertCan(actor, "upload");
  const scope = locationScope(actor);
  return prisma.importBatch.findMany({
    where: scope ? { uploadedBy: actor.id } : {},
    orderBy: { uploadedAt: "desc" },
    take: 10,
  });
}
