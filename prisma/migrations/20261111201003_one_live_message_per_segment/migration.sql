-- At most one drafted/approved/sent message per patient per segment.
-- Rejected and failed messages do not count, so a patient can be re-drafted after those.
CREATE UNIQUE INDEX "messages_one_live_per_patient_segment"
  ON "messages" ("patient_id", "segment")
  WHERE "status" IN ('drafted', 'approved', 'sent');
