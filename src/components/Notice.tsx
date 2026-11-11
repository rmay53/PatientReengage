export function Notice({ ok, err }: { ok?: string | string[]; err?: string | string[] }) {
  const o = Array.isArray(ok) ? ok[0] : ok;
  const e = Array.isArray(err) ? err[0] : err;
  return (
    <>
      {o && <div className="notice ok" role="status">{o}</div>}
      {e && <div className="notice err" role="alert">{e}</div>}
    </>
  );
}
