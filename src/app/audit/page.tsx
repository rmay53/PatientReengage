import { requirePage } from "@/lib/auth/session";
import { searchAudit, walkthroughReport, AUDIT_PAGE_SIZE } from "@/services/audit";
import { first, fmtDateTime, SEGMENT_LABELS } from "@/lib/labels";

type SP = Promise<Record<string, string | string[] | undefined>>;

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("view_counts");
  const sp = await searchParams;
  const filters = {
    q: first(sp.q) || undefined,
    action: first(sp.action) || undefined,
    userEmail: first(sp.user) || undefined,
    from: first(sp.from) || undefined,
    to: first(sp.to) || undefined,
    page: Number(first(sp.page) ?? 1) || 1,
  };
  const [{ total, items, page, actions }, report] = await Promise.all([searchAudit(actor, filters), walkthroughReport(actor)]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const link = (p: number) => {
    const qs = new URLSearchParams();
    Object.entries({ q: filters.q, action: filters.action, user: filters.userEmail, from: filters.from, to: filters.to }).forEach(([k, v]) => v && qs.set(k, v));
    qs.set("page", String(p));
    return `/audit?${qs}`;
  };

  return (
    <>
      <h1>Audit log</h1>
      <p className="lede">Who did what and when. Entries hold ids and counts only, never patient names, contact details or message text.</p>
      <form method="get" className="card row">
        <div className="field">
          <label htmlFor="a-action">Action</label>
          <select id="a-action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">All</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="a-user">User email</label><input id="a-user" name="user" defaultValue={filters.userEmail ?? ""} /></div>
        <div className="field"><label htmlFor="a-q">Entity id or detail</label><input id="a-q" name="q" defaultValue={filters.q ?? ""} /></div>
        <div className="field"><label htmlFor="a-from">From</label><input id="a-from" type="date" name="from" defaultValue={filters.from ?? ""} /></div>
        <div className="field"><label htmlFor="a-to">To</label><input id="a-to" type="date" name="to" defaultValue={filters.to ?? ""} /></div>
        <button type="submit">Search</button>
      </form>
      <p className="muted">{total} entries · page {page} of {pages}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.occurredAt)}</td>
                <td className="small">{e.user ? `${e.user.email} (${e.user.role})` : <span className="muted">system / patient</span>}</td>
                <td><code>{e.action}</code></td>
                <td className="small">{e.entityType}<div className="muted">{e.entityId}</div></td>
                <td className="small muted"><code>{e.details}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {page > 1 && <a className="btn" href={link(page - 1)}>Previous</a>}
        {page < pages && <a className="btn" href={link(page + 1)}>Next</a>}
      </div>

      <h2>Walkthrough report</h2>
      <p className="lede">For the front-desk walkthrough: how long approval runs took, and which messages were edited before approval.</p>
      <div className="grid2">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Approval run</th><th>User</th><th className="num">Approved</th><th className="num">Rejected</th><th className="num">Took</th></tr></thead>
            <tbody>
              {report.runs.length === 0 && <tr><td colSpan={5} className="muted">No approvals yet.</td></tr>}
              {report.runs.map((r, i) => (
                <tr key={i}>
                  <td className="small">{fmtDateTime(r.start)}</td>
                  <td className="small">{r.user}</td>
                  <td className="num">{r.approved}</td>
                  <td className="num">{r.rejected}</td>
                  <td className="num">{duration(r.end.getTime() - r.start.getTime())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: "0 10px" }}>A run is one user&apos;s approvals and rejections with less than 10 minutes between them.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Edited message</th><th>Before → after</th></tr></thead>
            <tbody>
              {!report.editedVisible && <tr><td colSpan={2} className="muted">Message text is not shown to viewers.</td></tr>}
              {report.editedVisible && report.edited.length === 0 && <tr><td colSpan={2} className="muted">No edited messages yet.</td></tr>}
              {report.edited.map((m) => (
                <tr key={m.id}>
                  <td className="small">{SEGMENT_LABELS[m.segment]} · {m.channel}<div className="muted">{m.template?.name}</div></td>
                  <td className="small">
                    <div className="msg-body muted"><s>{m.originalBody}</s></div>
                    <div className="msg-body">{m.body}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
