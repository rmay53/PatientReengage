import { redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/session";

export default async function Home() {
  const actor = await requirePage();
  redirect(actor.role === "viewer" ? "/segments" : "/upload");
}
