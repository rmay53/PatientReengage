import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await currentActor()) redirect("/");
  return (
    <div className="login">
      <LoginForm />
      <p className="muted small">Every user signs in with their own account. Ask an admin if you need one.</p>
    </div>
  );
}
