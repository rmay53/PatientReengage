import type { Metadata } from "next";
import "./globals.css";
import { currentActor } from "@/lib/auth/session";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Patient Re-engagement (Prototype)" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const location = actor?.locationId ? await prisma.location.findUnique({ where: { id: actor.locationId } }) : null;
  return (
    <html lang="en">
      <body>
        <div className="banner" role="alert">Prototype: test data only. Do not enter real patient information.</div>
        {actor && <Nav actor={actor} locationName={location?.name ?? null} />}
        <main>{children}</main>
      </body>
    </html>
  );
}
