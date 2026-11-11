import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { segmentCounts } from "@/services/segments";
import { DraftButton } from "./DraftButton";

export default async function SegmentsPage() {
  const actor = await requirePage("view_counts");
  const { rules, locations, cells } = await segmentCounts(actor);
  const canDraft = can(actor, "draft");
  const totals = (seg: (typeof rules)[number]["segment"]) =>
    locations.reduce(
      (acc, l) => {
        const c = cells[l.id][seg];
        return { total: acc.total + c.total, eligible: acc.eligible + c.eligible, pending: acc.pending + c.pending };
      },
      { total: 0, eligible: 0, pending: 0 },
    );

  return (
    <>
      <h1>Segments</h1>
      <p className="lede">
        Patients grouped by time since discharge. <strong>Eligible</strong> is how many would be drafted a message now, after
        the never-contact rules. Drafting creates messages in the <Link href="/queue">approval queue</Link>; nothing is sent until approved.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Segment</th>
              <th>Who</th>
              {locations.map((l) => <th key={l.id} className="num">{l.name.replace(" Physical Therapy", "")}</th>)}
              <th className="num">All</th>
              {canDraft && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const t = totals(r.segment);
              return (
                <tr key={r.segment}>
                  <td><strong>{r.label}</strong><div className="muted small">{r.purpose}</div></td>
                  <td className="small">{r.dischargeType === "completed" ? "Completed care" : "Stopped early"}, {r.minDays}-{r.maxDays} days ago</td>
                  {locations.map((l) => {
                    const c = cells[l.id][r.segment];
                    return (
                      <td key={l.id} className="num">
                        <div><strong>{c.eligible}</strong> <span className="muted small">eligible</span></div>
                        <div className="muted small">{c.total} in segment{c.pending ? ` · ${c.pending} pending` : ""}</div>
                      </td>
                    );
                  })}
                  <td className="num">
                    <div><strong>{t.eligible}</strong> <span className="muted small">eligible</span></div>
                    <div className="muted small">{t.total} in segment{t.pending ? ` · ${t.pending} pending` : ""}</div>
                  </td>
                  {canDraft && (
                    <td><DraftButton segment={r.segment} locationId={null} label={r.label} eligible={t.eligible} /></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canDraft && <p className="muted small">Your role can view counts only.</p>}
    </>
  );
}
