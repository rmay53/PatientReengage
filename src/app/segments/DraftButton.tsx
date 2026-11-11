"use client";
import { useState, useTransition } from "react";
import { draftSegmentAction } from "@/app/actions/messages";
import { SKIP_REASON_LABELS } from "@/lib/rules/eligibility";

const REASONS: Record<string, string> = { ...SKIP_REASON_LABELS, no_active_template: "No active template for the channel" };

export function DraftButton({ segment, locationId, label, eligible }: { segment: string; locationId: string | null; label: string; eligible: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      <button
        className="primary"
        disabled={pending || eligible === 0}
        onClick={() =>
          start(async () => {
            const r = await draftSegmentAction(segment, locationId);
            if (!r.ok) return setMsg({ ok: false, text: r.error });
            const skipped = Object.entries(r.data!.skipped)
              .map(([k, n]) => `${n} ${REASONS[k] ?? k}`.toLowerCase())
              .join("; ");
            setMsg({ ok: true, text: `Drafted ${r.data!.drafted}.${skipped ? ` Skipped: ${skipped}.` : ""}` });
          })
        }
      >
        {pending ? "Drafting..." : `Draft ${label}`}
      </button>
      {msg && <div className={`small ${msg.ok ? "" : "notice err"}`} style={{ marginTop: 4 }}>{msg.text}</div>}
    </div>
  );
}
