"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAction, approveManyAction, rejectAction } from "@/app/actions/messages";

export interface QueueItem {
  id: string;
  patientId: string;
  patientName: string;
  therapist: string;
  location: string;
  segment: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
}

const SMS_MAX = 300;

function Row({ item, selected, onSelect, onDone }: { item: QueueItem; selected: boolean; onSelect: (v: boolean) => void; onDone: (msg: string, ok: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [subject, setSubject] = useState(item.subject ?? "");
  const [pending, start] = useTransition();
  const over = item.channel === "sms" && body.length > SMS_MAX;

  const act = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      onDone(r.ok ? okMsg : (r as { error: string }).error, r.ok);
    });

  return (
    <tr>
      <td><input type="checkbox" aria-label={`Select message for ${item.patientName}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></td>
      <td>
        <a href={`/patients/${item.patientId}`}>{item.patientName}</a>
        <div className="muted small">{item.location}</div>
      </td>
      <td>{item.therapist}</td>
      <td>{item.segment}</td>
      <td><span className="pill">{item.channel === "sms" ? "Text" : "Email"}</span></td>
      <td>
        {editing ? (
          <div className="stack">
            {item.channel === "email" && (
              <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%" }} />
            )}
            <textarea aria-label="Message text" value={body} onChange={(e) => setBody(e.target.value)} rows={item.channel === "sms" ? 4 : 8} />
            {item.channel === "sms" && <div className={`counter ${over ? "over" : ""}`}>{body.length} / {SMS_MAX} characters</div>}
            {item.channel === "email" && <div className="muted small">An unsubscribe link is added to every email automatically.</div>}
          </div>
        ) : (
          <>
            {item.subject && <div><strong>{item.subject}</strong></div>}
            <div className="msg-body">{item.body}</div>
            {item.channel === "sms" && <div className="counter">{item.body.length} / {SMS_MAX}</div>}
          </>
        )}
      </td>
      <td>
        <div className="actions">
          {editing ? (
            <>
              <button
                className="primary"
                disabled={pending || over}
                onClick={() => act(() => approveAction(item.id, { body, subject: item.channel === "email" ? subject : null }), "Edited, approved and sent.")}
              >
                Save &amp; approve
              </button>
              <button disabled={pending} onClick={() => { setEditing(false); setBody(item.body); setSubject(item.subject ?? ""); }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="primary" disabled={pending} onClick={() => act(() => approveAction(item.id), "Approved and sent.")}>Approve</button>
              <button disabled={pending} onClick={() => setEditing(true)}>Edit</button>
              <button className="danger" disabled={pending} onClick={() => act(() => rejectAction(item.id), "Rejected.")}>Reject</button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function QueueClient({ items, total }: { items: QueueItem[]; total: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const done = (text: string, ok: boolean) => {
    setNotice({ text, ok });
    router.refresh();
  };

  function approveSelected() {
    const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Approve and send ${ids.length} message(s) as they are?`)) return;
    start(async () => {
      const r = await approveManyAction(ids);
      if (!r.ok) return done(r.error, false);
      const { approved, failed } = r.data!;
      setSelected(new Set());
      done(`Approved and sent ${approved}.${failed.length ? ` ${failed.length} not sent: ${[...new Set(failed.map((f) => f.error))].join(" ")}` : ""}`, failed.length === 0);
    });
  }

  return (
    <>
      {notice && <div className={`notice ${notice.ok ? "ok" : "err"}`} role="status">{notice.text}</div>}
      <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
        <div className="muted">
          Showing {items.length} of {total} drafted message(s). {selected.size > 0 && <strong>{selected.size} selected</strong>}
        </div>
        <button className="primary" disabled={pending || selected.size === 0} onClick={approveSelected}>
          {pending ? "Approving..." : `Approve all selected (${selected.size})`}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                />
              </th>
              <th>Patient</th>
              <th>Therapist</th>
              <th>Segment</th>
              <th>Channel</th>
              <th>Message</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} className="muted">Nothing waiting for approval. Draft a segment from the Segments page.</td></tr>
            )}
            {items.map((i) => (
              <Row key={i.id} item={i} selected={selected.has(i.id)} onSelect={(v) => toggle(i.id, v)} onDone={done} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
