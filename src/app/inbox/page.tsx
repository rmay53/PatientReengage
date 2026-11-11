import { requirePage } from "@/lib/auth/session";
import { listInbox } from "@/services/replies";
import { getPatient } from "@/services/patients";
import { CATEGORY_LABELS, CHANNEL_LABELS, first, fmtDateTime } from "@/lib/labels";
import { ReplyActions, TestPanel } from "./InboxClient";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("handle_inbox");
  const sp = await searchParams;
  const showHandled = first(sp.show) === "all";
  const replies = await listInbox(actor, { showHandled });
  const preselectId = first(sp.patient);
  const preselect = preselectId ? await getPatient(actor, preselectId).catch(() => null) : null;

  return (
    <>
      <h1>Inbox</h1>
      <p className="lede">
        Patient replies, sorted automatically. Clinical replies are marked urgent and never get an automatic answer.
        Opt-outs are applied straight away. {showHandled ? <a href="/inbox">Show waiting only</a> : <a href="/inbox?show=all">Include handled replies</a>}
      </p>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(300px, 1fr)", alignItems: "start" }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Received</th><th>Patient</th><th>Sorted as</th><th>Reply</th><th>Response</th></tr></thead>
            <tbody>
              {replies.length === 0 && <tr><td colSpan={5} className="muted">No replies waiting. Use the test panel to simulate one.</td></tr>}
              {replies.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmtDateTime(r.receivedAt)}<div className="muted">{CHANNEL_LABELS[r.channel]}</div></td>
                  <td>
                    <a href={`/patients/${r.patientId}`}>{r.patient.firstName} {r.patient.lastName}</a>
                    <div className="muted small">{r.patient.location.name}</div>
                  </td>
                  <td>
                    <span className={`pill ${r.urgent ? "urgent" : ""}`}>{r.urgent ? "URGENT · " : ""}{CATEGORY_LABELS[r.category]}</span>
                  </td>
                  <td><div className="msg-body">{r.body}</div></td>
                  <td style={{ minWidth: 240 }}>
                    {r.handledAt ? (
                      <div className="small">
                        <span className="muted">Handled {fmtDateTime(r.handledAt)}{r.handledBy ? "" : " automatically"}</span>
                        {r.responseBody && <div className="msg-body">Sent: {r.responseBody}</div>}
                      </div>
                    ) : (
                      <>
                        {r.responseBody && <div className="small muted">Opt-out confirmation sent: {r.responseBody}</div>}
                        <ReplyActions replyId={r.id} suggested={r.category === "booking" ? r.suggestedReply : null} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TestPanel
          initialPatientId={preselect?.id}
          initialLabel={preselect ? `${preselect.firstName} ${preselect.lastName} (${preselect.externalId}) - ${preselect.location.name}` : undefined}
        />
      </div>
    </>
  );
}
