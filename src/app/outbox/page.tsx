import { requirePage } from "@/lib/auth/session";
import { locationScope } from "@/lib/auth/permissions";
import { listOutbox } from "@/services/messages";
import { listLocations } from "@/services/settings";
import { asSegment, CHANNEL_LABELS, first, fmtDateTime, SEGMENT_LABELS } from "@/lib/labels";
import { Filters } from "@/components/Filters";
import { prisma } from "@/lib/db";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OutboxPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("view_patients");
  const sp = await searchParams;
  const scope = locationScope(actor);
  const statusParam = first(sp.status);
  const filters = {
    locationId: first(sp.locationId) || undefined,
    segment: asSegment(first(sp.segment)),
    channel: (["sms", "email"] as const).find((c) => c === first(sp.channel)),
    status: (["approved", "sent", "failed"] as const).find((s) => s === statusParam),
  };
  const [messages, allLocations] = await Promise.all([listOutbox(actor, filters), listLocations()]);
  const locations = scope ? allLocations.filter((l) => scope.includes(l.id)) : allLocations;
  const approverIds = [...new Set(messages.map((m) => m.decidedBy).filter((x): x is string => !!x))];
  const approvers = new Map((await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));

  return (
    <>
      <h1>Outbox</h1>
      <p className="lede">Approved messages and their simulated send. Nothing here was really delivered.</p>
      <Filters
        locations={locations}
        values={filters}
        showTherapist={false}
        extra={
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="approved">Approved, not yet sent</option>
            </select>
          </div>
        }
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Simulated send</th><th>Status</th><th>Patient</th><th>Segment</th><th>Channel</th><th>Approved by</th><th>Message</th></tr>
          </thead>
          <tbody>
            {messages.length === 0 && <tr><td colSpan={7} className="muted">No approved messages yet.</td></tr>}
            {messages.map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.sentAt) || <span className="muted">-</span>}</td>
                <td><span className={`pill ${m.status}`}>{m.status}</span></td>
                <td>
                  <a href={`/patients/${m.patientId}`}>{m.patient.firstName} {m.patient.lastName}</a>
                  <div className="muted small">{m.patient.location.name}</div>
                </td>
                <td>{SEGMENT_LABELS[m.segment]}</td>
                <td>{CHANNEL_LABELS[m.channel]}</td>
                <td className="small">
                  {m.decidedBy ? approvers.get(m.decidedBy) ?? m.decidedBy : ""}
                  <div className="muted">{fmtDateTime(m.decidedAt)}{m.edited ? " · edited" : ""}</div>
                </td>
                <td>
                  {m.subject && <div><strong>{m.subject}</strong></div>}
                  <div className="msg-body small">{m.body}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
