"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveSuggestedAction, findPatientsAction, markHandledAction, testReplyAction } from "@/app/actions/inbox";

export function TestPanel({ initialPatientId, initialLabel }: { initialPatientId?: string; initialLabel?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>(initialPatientId ? [{ id: initialPatientId, label: initialLabel ?? initialPatientId }] : []);
  const [patientId, setPatientId] = useState(initialPatientId ?? "");
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"" | "sms" | "email">("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = () =>
    start(async () => {
      const r = await findPatientsAction(q);
      if (!r.ok) return setError(r.error);
      setOptions(r.data!);
      setPatientId(r.data![0]?.id ?? "");
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await testReplyAction(patientId, text, channel);
      if (!r.ok) return setError(r.error);
      const d = r.data!;
      const parts = [`Sorted as ${d.category.replace("_", "-")}`];
      if (d.urgent) parts.push("marked URGENT for staff");
      if (d.optOut) parts.push("opt-out flags set and confirmation sent (simulated)");
      if (d.suggestedReply) parts.push("suggested reply is waiting for approval below");
      if (!d.suggestedReply && !d.optOut) parts.push("no automatic answer; waiting for staff");
      setResult(parts.join(" · ") + ".");
      setText("");
      router.refresh();
    });

  return (
    <div className="card stack">
      <h2 style={{ marginTop: 0 }}>Test panel: reply as a patient</h2>
      <p className="muted small">Simulates a patient replying. Use invented text only.</p>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="tp-q">Find patient (name or external id)</label>
          <input id="tp-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        </div>
        <button onClick={search} disabled={pending}>Search</button>
      </div>
      <div className="field">
        <label htmlFor="tp-p">Patient</label>
        <select id="tp-p" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          <option value="">Choose...</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tp-ch">Arrives by</label>
        <select id="tp-ch" value={channel} onChange={(e) => setChannel(e.target.value as "" | "sms" | "email")}>
          <option value="">Same channel as the last message sent</option>
          <option value="sms">Text</option>
          <option value="email">Email</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="tp-t">Reply text</label>
        <textarea id="tp-t" value={text} onChange={(e) => setText(e.target.value)} placeholder='Try "STOP", "Can I book an appointment?", "My knee pain is back", or "Thanks!"' />
      </div>
      <div><button className="primary" disabled={pending || !patientId || !text.trim()} onClick={submit}>Submit test reply</button></div>
      {result && <div className="notice ok" role="status">{result}</div>}
      {error && <div className="notice err" role="alert">{error}</div>}
    </div>
  );
}

export function ReplyActions({ replyId, suggested }: { replyId: string; suggested: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(suggested ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Failed");
      router.refresh();
    });
  return (
    <div className="stack">
      {suggested && (
        <>
          <label htmlFor={`sr-${replyId}`}>Suggested reply (sent only if you approve)</label>
          <textarea id={`sr-${replyId}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </>
      )}
      <div className="actions">
        {suggested && (
          <button className="primary" disabled={pending || !text.trim()} onClick={() => go(() => approveSuggestedAction(replyId, text))}>
            Approve &amp; send reply
          </button>
        )}
        <button disabled={pending} onClick={() => go(() => markHandledAction(replyId))}>
          {suggested ? "Handled without replying" : "Mark handled"}
        </button>
      </div>
      {error && <div className="notice err">{error}</div>}
    </div>
  );
}
