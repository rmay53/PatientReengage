"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { commitUploadAction, previewUploadAction } from "@/app/actions/upload";

type Preview = Awaited<ReturnType<typeof previewUploadAction>>;

export function UploadClient() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setPreview(null);
    setDone(null);
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return setFile(null);
    if (f.size > 2 * 1024 * 1024) return setError("File is larger than 2 MB.");
    const text = await f.text();
    setFile({ name: f.name, text });
    start(async () => setPreview(await previewUploadAction(text)));
  }

  function confirm() {
    if (!file) return;
    start(async () => {
      const r = await commitUploadAction(file.name, file.text);
      if (!r.ok) return setError(r.error);
      const d = r.data!;
      setDone(`Imported: ${d.created} new patient(s), ${d.updated} updated, ${d.rejected} row(s) rejected.`);
      setPreview(null);
      setFile(null);
    });
  }

  const data = preview?.ok ? preview.data : null;
  return (
    <div>
      {done && (
        <div className="notice ok" role="status">
          {done} <Link href="/segments">Go to segments</Link>
        </div>
      )}
      {error && <div className="notice err" role="alert">{error}</div>}
      <div className="card">
        <label htmlFor="csv">CSV file of discharged patients</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} />
        <p className="muted small">
          Columns: external_id, first_name, last_name, email, mobile, location, therapist, discharge_date (YYYY-MM-DD),
          discharge_type (completed or lapsed), sms_opt_in (yes/no). Files containing diagnosis, date of birth, insurance,
          address, body region or notes columns are refused.
        </p>
        {pending && <p className="muted">Checking file...</p>}
      </div>

      {preview && !preview.ok && <div className="notice err">{preview.error}</div>}
      {data && "fatal" in data && data.fatal && <div className="notice err" role="alert">{data.fatal}</div>}

      {data && "accepted" in data && data.accepted && (
        <>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{data.accepted.length}</strong> row(s) ready to import
              ({data.accepted.filter((r) => r.isUpdate).length} update existing patients) ·{" "}
              <strong>{data.rejected.length}</strong> rejected
            </div>
            <button className="primary" onClick={confirm} disabled={pending || data.accepted.length === 0}>
              Confirm import of {data.accepted.length} row(s)
            </button>
          </div>

          {data.rejected.length > 0 && (
            <>
              <h2>Rejected rows</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>external_id</th><th>Why</th></tr></thead>
                  <tbody>
                    {data.rejected.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="num">{r.rowNumber}</td>
                        <td>{r.externalId || <span className="muted">(blank)</span>}</td>
                        <td>{r.reasons.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2>Preview</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Row</th><th>external_id</th><th>Name</th><th>Location</th><th>Therapist</th><th>Discharged</th><th>Type</th><th>Contact</th><th>Text opt-in</th><th></th></tr>
              </thead>
              <tbody>
                {data.accepted.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="num">{r.rowNumber}</td>
                    <td>{r.externalId}</td>
                    <td>{r.name}</td>
                    <td>{r.location}</td>
                    <td>{r.therapist}</td>
                    <td>{r.dischargeDate}</td>
                    <td>{r.dischargeType}</td>
                    <td>{[r.hasMobile && "mobile", r.hasEmail && "email"].filter(Boolean).join(", ")}</td>
                    <td>{r.smsOptIn ? "yes" : "no"}</td>
                    <td>{r.isUpdate && <span className="pill">update</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
