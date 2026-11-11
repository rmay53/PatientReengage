import { requirePage } from "@/lib/auth/session";
import { searchPatients } from "@/services/patients";
import { first, fmtDate } from "@/lib/labels";
import { formatMobile } from "@/lib/rules/csv";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PatientsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("view_patients");
  const q = first((await searchParams).q) ?? "";
  const { total, items } = await searchPatients(actor, q);
  return (
    <>
      <h1>Patients</h1>
      <form method="get" className="card row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="q">Search by name, external id or email</label>
          <input id="q" name="q" defaultValue={q} />
        </div>
        <button type="submit">Search</button>
      </form>
      <p className="muted">Showing {items.length} of {total}.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>External id</th><th>Location</th><th>Discharged</th><th>Contact</th><th>Flags</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><a href={`/patients/${p.id}`}>{p.lastName}, {p.firstName}</a></td>
                <td>{p.externalId}</td>
                <td>{p.location.name}</td>
                <td>{fmtDate(p.dischargeDate)} <span className="muted small">{p.dischargeType}</span></td>
                <td className="small">{formatMobile(p.mobile)}{p.mobile && p.email ? " · " : ""}{p.email}</td>
                <td className="actions">
                  {p.doNotContact && <span className="pill urgent">Do not contact</span>}
                  {p.smsOptOut && <span className="pill warn">Text opt-out</span>}
                  {p.emailOptOut && <span className="pill warn">Email opt-out</span>}
                  {p.smsOptIn && !p.smsOptOut && <span className="pill">Text opt-in</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
