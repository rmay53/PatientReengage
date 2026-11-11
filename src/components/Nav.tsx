import Link from "next/link";
import { can, type Actor } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/actions/auth";

export function Nav({ actor, locationName }: { actor: Actor; locationName: string | null }) {
  const links: [string, string, boolean][] = [
    ["/upload", "Upload", can(actor, "upload")],
    ["/segments", "Segments", can(actor, "view_counts")],
    ["/queue", "Approval queue", can(actor, "approve")],
    ["/outbox", "Outbox", can(actor, "view_patients")],
    ["/inbox", "Inbox", can(actor, "handle_inbox")],
    ["/patients", "Patients", can(actor, "view_patients")],
    ["/audit", "Audit log", can(actor, "view_counts")],
    ["/settings", "Settings", can(actor, "admin")],
  ];
  return (
    <header className="topbar">
      <span className="brand">Re-engagement</span>
      <nav className="nav">
        {links.filter(([, , show]) => show).map(([href, label]) => (
          <Link key={href} href={href}>{label}</Link>
        ))}
      </nav>
      <div className="whoami">
        <span>{actor.email} · {actor.role}{locationName ? ` · ${locationName}` : ""}</span>
        <form action={logoutAction}><button type="submit">Sign out</button></form>
      </div>
    </header>
  );
}
