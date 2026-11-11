import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/permissions";
import { getPatient } from "@/services/patients";
import { getSegmentRules } from "@/services/segments";
import { assignSegment } from "@/lib/rules/segments";
import { CATEGORY_LABELS, CHANNEL_LABELS, fmtDate, fmtDateTime, SEGMENT_LABELS } from "@/lib/labels";
import { formatMobile } from "@/lib/rules/csv";
import { setFlagAction } from "@/app/actions/patients";
import { Notice } from "@/components/Notice";

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

const FLAG_LABELS = {
  smsOptIn: "Text opt-in",
  smsOptOut: "Text opt-out",
  emailOptOut: "Email opt-out",
  doNotContact: "Do not contact",
} as const;

export default async function PatientPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const actor = await requirePage("view_patients");
  const { id } = await params;
  const sp = await searchParams;
  let patient;
  try {
    patient = await getPatient(actor, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  if (!patient) notFound();
  const segment = assignSegment(patient, new Date(), await getSegmentRules());

  type Item = { at: Date; kind: "message" | "reply"; node: React.ReactNode };
  const history: Item[] = [
    ...patient.messages.map((m) => ({
      at: m.sentAt ?? m.decidedAt ?? m.draftedAt,
      kind: "message" as const,
      node: (
        <>
          <span className={`pill ${m.status}`}>{m.status}</span> Outbound {CHANNEL_LABELS[m.channel].toLowerCase()} · {SEGMENT_LABELS[m.segment]}
          {m.edited && " · edited before approval"}
          {m.subject && <div><strong>{m.subject}</strong></div>}
          <div className="msg-body small">{m.body}</div>
        </>
      ),
    })),
    ...patient.replies.map((r) => ({
      at: r.receivedAt,
      kind: "reply" as const,
      node: (
        <>
          <span className={`pill ${r.urgent ? "urgent" : ""}`}>{CATEGORY_LABELS[r.category]}</span> Reply by {CHANNEL_LABELS[r.channel].toLowerCase()}
          <div className="msg-body small">{r.body}</div>
          {r.responseBody && <div className="msg-body small muted">Our response: {r.responseBody}</div>}
        </>
      ),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <Notice ok={sp.ok} err={sp.err} />
      <h1>{patient.firstName} {patient.lastName}</h1>
      <p className="lede">{patient.externalId} · {patient.location.name}</p>
      <div className="grid2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Contact details</h2>
          <table>
            <tbody>
              <tr><th>Mobile</th><td>{formatMobile(patient.mobile) || <span className="muted">none</span>}</td></tr>
              <tr><th>Email</th><td>{patient.email ?? <span className="muted">none</span>}</td></tr>
              <tr><th>Therapist</th><td>{patient.therapist ? `${patient.therapist.firstName} ${patient.therapist.lastName}` : ""}</td></tr>
              <tr><th>Discharged</th><td>{fmtDate(patient.dischargeDate)} ({patient.dischargeType})</td></tr>
              <tr><th>Segment today</th><td>{segment ? SEGMENT_LABELS[segment] : <span className="muted">none</span>}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Contact preferences</h2>
          <table>
            <tbody>
              {(Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[]).map((flag) => {
                const value = patient[flag];
                const protective = flag !== "smsOptIn";
                const canChange = actor.role === "admin" || (protective ? !value : !(value === false && patient.smsOptOut));
                return (
                  <tr key={flag}>
                    <th>{FLAG_LABELS[flag]}</th>
                    <td>{value ? <strong>Yes</strong> : "No"}</td>
                    <td>
                      {actor.role !== "viewer" && canChange && (
                        <form action={setFlagAction} className="inline">
                          <input type="hidden" name="patientId" value={patient.id} />
                          <input type="hidden" name="flag" value={flag} />
                          <input type="hidden" name="value" value={String(!value)} />
                          <button type="submit">{value ? "Clear" : "Set"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Only an admin can clear an opt-out or do-not-contact flag.</p>
          <p className="small"><a href={`/inbox?patient=${patient.id}`}>Simulate a reply from this patient</a></p>
        </div>
      </div>
      <h2>Message history</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Detail</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={2} className="muted">No messages yet.</td></tr>}
            {history.map((h, i) => (
              <tr key={i}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(h.at)}</td>
                <td>{h.node}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
