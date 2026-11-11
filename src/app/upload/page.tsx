import { requirePage } from "@/lib/auth/session";
import { recentImports } from "@/services/imports";
import { fmtDateTime } from "@/lib/labels";
import { UploadClient } from "./UploadClient";

export default async function UploadPage() {
  const actor = await requirePage("upload");
  const batches = await recentImports(actor);
  return (
    <>
      <h1>Upload discharged patients</h1>
      <p className="lede">
        Choose a CSV, check the preview and rejected rows, then confirm. Patients already on file (same external_id) are
        updated, never duplicated, and their opt-out flags are never cleared.
        {actor.role === "approver" && " You can only import patients for your own location."}
      </p>
      <UploadClient />
      {batches.length > 0 && (
        <>
          <h2>Recent uploads</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>File</th><th className="num">Accepted</th><th className="num">Rejected</th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDateTime(b.uploadedAt)}</td>
                    <td>{b.fileName}</td>
                    <td className="num">{b.rowsAccepted}</td>
                    <td className="num">{b.rowsRejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
