import { SEGMENT_KEYS, SEGMENT_LABELS } from "@/lib/labels";

export function Filters({
  locations,
  therapists,
  values,
  showTherapist = true,
  extra,
}: {
  locations: { id: string; name: string }[];
  therapists?: { id: string; firstName: string; lastName: string; locationId: string }[];
  values: { locationId?: string; therapistId?: string; segment?: string; channel?: string };
  showTherapist?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <form method="get" className="card row">
      {locations.length > 1 && (
        <div className="field">
          <label htmlFor="f-loc">Location</label>
          <select id="f-loc" name="locationId" defaultValue={values.locationId ?? ""}>
            <option value="">All</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      {showTherapist && therapists && (
        <div className="field">
          <label htmlFor="f-ther">Therapist</label>
          <select id="f-ther" name="therapistId" defaultValue={values.therapistId ?? ""}>
            <option value="">All</option>
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
                {locations.length > 1 ? ` (${locations.find((l) => l.id === t.locationId)?.name.replace(" Physical Therapy", "") ?? ""})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="f-seg">Segment</label>
        <select id="f-seg" name="segment" defaultValue={values.segment ?? ""}>
          <option value="">All</option>
          {SEGMENT_KEYS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-ch">Channel</label>
        <select id="f-ch" name="channel" defaultValue={values.channel ?? ""}>
          <option value="">All</option>
          <option value="sms">Text</option>
          <option value="email">Email</option>
        </select>
      </div>
      {extra}
      <button type="submit">Apply filters</button>
    </form>
  );
}
