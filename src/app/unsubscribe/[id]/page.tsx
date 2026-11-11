import { unsubscribeByMessage } from "@/services/patients";

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

async function confirm(form: FormData) {
  "use server";
  const id = String(form.get("id") ?? "");
  const ok = await unsubscribeByMessage(id);
  const { redirect } = await import("next/navigation");
  redirect(`/unsubscribe/${encodeURIComponent(id)}?done=${ok ? "1" : "0"}`);
}

/** Public page linked from every email. Requires a click so link scanners cannot unsubscribe people. */
export default async function UnsubscribePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const { done } = await searchParams;
  return (
    <div className="login card stack">
      <h1>Unsubscribe</h1>
      {done === "1" ? (
        <p>You&apos;re unsubscribed and won&apos;t receive more emails from us.</p>
      ) : done === "0" ? (
        <p>This link is not valid. Please call the clinic and we&apos;ll remove you.</p>
      ) : (
        <form action={confirm} className="stack">
          <input type="hidden" name="id" value={id} />
          <p>Stop receiving check-in emails from the clinic?</p>
          <button className="primary" type="submit">Unsubscribe</button>
        </form>
      )}
    </div>
  );
}
