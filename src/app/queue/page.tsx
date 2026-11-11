import { requirePage } from "@/lib/auth/session";
import { locationScope } from "@/lib/auth/permissions";
import { listQueue } from "@/services/messages";
import { listLocations, listTherapists } from "@/services/settings";
import { asSegment, first, SEGMENT_LABELS } from "@/lib/labels";
import { Filters } from "@/components/Filters";
import { QueueClient } from "./QueueClient";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function QueuePage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("approve");
  const sp = await searchParams;
  const scope = locationScope(actor);
  const filters = {
    locationId: first(sp.locationId) || undefined,
    therapistId: first(sp.therapistId) || undefined,
    segment: asSegment(first(sp.segment)),
    channel: (["sms", "email"] as const).find((c) => c === first(sp.channel)),
  };
  const [{ items, total }, allLocations, therapists] = await Promise.all([listQueue(actor, filters), listLocations(), listTherapists(scope)]);
  const locations = scope ? allLocations.filter((l) => scope.includes(l.id)) : allLocations;

  return (
    <>
      <h1>Approval queue</h1>
      <p className="lede">Nothing is sent until you approve it. Approving records your name against the message, then sends it (simulated).</p>
      <Filters locations={locations} therapists={therapists} values={filters} />
      <QueueClient
        total={total}
        items={items.map((m) => ({
          id: m.id,
          patientId: m.patientId,
          patientName: `${m.patient.firstName} ${m.patient.lastName}`,
          therapist: m.patient.therapist ? `${m.patient.therapist.firstName} ${m.patient.therapist.lastName}` : "",
          location: m.patient.location.name,
          segment: SEGMENT_LABELS[m.segment],
          channel: m.channel,
          subject: m.subject,
          body: m.body,
        }))}
      />
    </>
  );
}
