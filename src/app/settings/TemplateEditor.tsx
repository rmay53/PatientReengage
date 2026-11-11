"use client";
import { useActionState, useState } from "react";
import { saveTemplateAction } from "@/app/actions/settings";
import { LENGTH_ESTIMATE_CONTEXT, MERGE_FIELDS, render, SMS_MAX_LENGTH, SMS_OPT_OUT_PATTERN, type MergeContext } from "@/lib/rules/templates";
import { SEGMENT_KEYS, SEGMENT_LABELS } from "@/lib/labels";

export interface TemplateRow {
  id: string;
  name: string;
  segment: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  active: boolean;
}

export function TemplateEditor({ template, sample = LENGTH_ESTIMATE_CONTEXT }: { template?: TemplateRow; sample?: MergeContext }) {
  const [state, action, pending] = useActionState(saveTemplateAction, undefined);
  const [channel, setChannel] = useState<"sms" | "email">(template?.channel ?? "sms");
  const [body, setBody] = useState(template?.body ?? "");
  const rendered = render(body, sample);
  const over = channel === "sms" && rendered.length > SMS_MAX_LENGTH;
  const missingOptOut = channel === "sms" && body.length > 0 && !SMS_OPT_OUT_PATTERN.test(body);

  return (
    <form action={action} className="card stack">
      <input type="hidden" name="id" value={template?.id ?? ""} />
      {state?.error && <div className="notice err" role="alert">{state.error}</div>}
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Name</label>
          <input name="name" defaultValue={template?.name ?? ""} required />
        </div>
        <div className="field">
          <label>Segment</label>
          <select name="segment" defaultValue={template?.segment ?? "check_in"}>
            {SEGMENT_KEYS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Channel</label>
          <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value as "sms" | "email")}>
            <option value="sms">Text</option>
            <option value="email">Email</option>
          </select>
        </div>
        <div className="field">
          <label><input type="checkbox" name="active" defaultChecked={template?.active ?? true} /> Active</label>
        </div>
      </div>
      {channel === "email" && (
        <div className="field">
          <label>Subject</label>
          <input name="subject" defaultValue={template?.subject ?? ""} />
        </div>
      )}
      <div className="field">
        <label>Body</label>
        <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "sms" ? 4 : 8} />
        {channel === "sms" ? (
          <div className={`counter ${over ? "over" : ""}`}>
            {body.length} characters as written · about {rendered.length} / {SMS_MAX_LENGTH} with names filled in
            {missingOptOut && <span className="counter over"> · needs opt-out wording, e.g. &quot;Reply STOP to opt out.&quot;</span>}
          </div>
        ) : (
          <div className="muted small">An unsubscribe link is added to every email automatically.</div>
        )}
        <div className="muted small">Merge fields: {MERGE_FIELDS.map((f) => `{${f}}`).join(" ")}</div>
      </div>
      <details>
        <summary className="small">Preview with sample values</summary>
        <div className="msg-body small">{rendered}</div>
      </details>
      <div><button className="primary" type="submit" disabled={pending || over}>{template ? "Save template" : "Add template"}</button></div>
    </form>
  );
}
