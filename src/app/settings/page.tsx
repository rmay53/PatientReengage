import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { lengthSampleContext, listLocations, listTemplates, listTherapists, listUsers } from "@/services/settings";
import { getSegmentRules } from "@/services/segments";
import { first, SEGMENT_LABELS } from "@/lib/labels";
import { Notice } from "@/components/Notice";
import {
  createUserAction,
  saveLocationAction,
  saveSegmentRuleAction,
  saveTherapistAction,
  updateUserAction,
} from "@/app/actions/settings";
import { TemplateEditor } from "./TemplateEditor";

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = ["users", "locations", "therapists", "templates", "segments"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePage("admin");
  const sp = await searchParams;
  const tab = TABS.find((t) => t === first(sp.tab)) ?? "users";
  const locations = await listLocations();

  const locationSelect = (name: string, value: string | null, allowNone = true) => (
    <select name={name} defaultValue={value ?? ""}>
      {allowNone && <option value="">(none)</option>}
      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );

  return (
    <>
      <h1>Settings</h1>
      <nav className="actions" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link key={t} href={`/settings?tab=${t}`} className={`btn ${t === tab ? "primary" : ""}`}>{t[0].toUpperCase() + t.slice(1)}</Link>
        ))}
      </nav>
      <Notice ok={sp.ok} err={sp.err} />

      {tab === "users" && (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Location</th><th>Active</th><th>New password</th><th></th></tr></thead>
              <tbody>
                {(await listUsers(actor)).map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td colSpan={5}>
                      <form action={updateUserAction} className="row">
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role}>
                          <option value="admin">Admin</option>
                          <option value="approver">Approver</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        {locationSelect("locationId", u.locationId)}
                        <label><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                        <input name="newPassword" type="password" placeholder="Leave blank to keep" autoComplete="new-password" />
                        <button type="submit">Save</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Add user</h2>
          <form action={createUserAction} className="card row">
            <div className="field"><label>Email</label><input name="email" type="email" required /></div>
            <div className="field"><label>Password (12+ characters)</label><input name="password" type="password" minLength={12} required autoComplete="new-password" /></div>
            <div className="field">
              <label>Role</label>
              <select name="role" defaultValue="approver">
                <option value="admin">Admin</option>
                <option value="approver">Approver</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="field"><label>Location (required for approvers)</label>{locationSelect("locationId", null)}</div>
            <button className="primary" type="submit">Add user</button>
          </form>
        </>
      )}

      {tab === "locations" && (
        <div className="stack">
          {[...locations, null].map((l) => (
            <form key={l?.id ?? "new"} action={saveLocationAction} className="card row">
              <input type="hidden" name="id" value={l?.id ?? ""} />
              <div className="field" style={{ flex: 1 }}><label>Name</label><input name="name" defaultValue={l?.name ?? ""} required /></div>
              <div className="field"><label>Phone</label><input name="phone" defaultValue={l?.phone ?? ""} required /></div>
              <div className="field" style={{ flex: 1 }}><label>Booking link</label><input name="bookingLink" type="url" defaultValue={l?.bookingLink ?? ""} required /></div>
              <button className={l ? "" : "primary"} type="submit">{l ? "Save" : "Add location"}</button>
            </form>
          ))}
        </div>
      )}

      {tab === "therapists" && (
        <div className="stack">
          {[...(await listTherapists()), null].map((t) => (
            <form key={t?.id ?? "new"} action={saveTherapistAction} className="card row">
              <input type="hidden" name="id" value={t?.id ?? ""} />
              <div className="field"><label>First name</label><input name="firstName" defaultValue={t?.firstName ?? ""} required /></div>
              <div className="field"><label>Last name</label><input name="lastName" defaultValue={t?.lastName ?? ""} required /></div>
              <div className="field"><label>Location</label>{locationSelect("locationId", t?.locationId ?? locations[0]?.id ?? null, false)}</div>
              <label><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Active</label>
              <button className={t ? "" : "primary"} type="submit">{t ? "Save" : "Add therapist"}</button>
            </form>
          ))}
        </div>
      )}

      {tab === "templates" && (
        <TemplatesTab sample={await lengthSampleContext()} templates={await listTemplates(actor)} />
      )}

      {tab === "segments" && (
        <>
          <p className="lede">Day ranges since discharge (inclusive). If ranges overlap, a patient goes in the first matching segment.</p>
          <div className="stack">
            {(await getSegmentRules()).map((r) => (
              <form key={r.segment} action={saveSegmentRuleAction} className="card row">
                <input type="hidden" name="segment" value={r.segment} />
                <div className="field" style={{ flex: 1 }}>
                  <strong>{SEGMENT_LABELS[r.segment]}</strong>
                  <span className="muted small">{r.dischargeType === "completed" ? "Completed care" : "Stopped before finishing"} · {r.purpose}</span>
                </div>
                <div className="field"><label>From day</label><input name="minDays" type="number" min={0} defaultValue={r.minDays} style={{ width: 90 }} /></div>
                <div className="field"><label>To day</label><input name="maxDays" type="number" min={0} defaultValue={r.maxDays} style={{ width: 90 }} /></div>
                <button type="submit">Save</button>
              </form>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function TemplatesTab({ templates, sample }: { templates: Awaited<ReturnType<typeof listTemplates>>; sample: Awaited<ReturnType<typeof lengthSampleContext>> }) {
  return (
    <>
      <p className="lede">
        One active template per segment and channel is used for drafting. Texts are capped at 300 characters and must include
        opt-out wording. Merge fields never carry clinical information.
      </p>
      {templates.map((t) => (
        <details key={t.id} className="card">
          <summary>
            <strong>{t.name}</strong> <span className="muted">· {SEGMENT_LABELS[t.segment]} · {t.channel === "sms" ? "Text" : "Email"}</span>
            {!t.active && <span className="pill warn" style={{ marginLeft: 8 }}>inactive</span>}
          </summary>
          <TemplateEditor template={t} sample={sample} />
        </details>
      ))}
      <h2>Add template</h2>
      <TemplateEditor sample={sample} />
    </>
  );
}
