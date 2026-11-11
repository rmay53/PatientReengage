import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="card">
      <h1>Not available for your role</h1>
      <p className="lede">Your account does not have access to that page.</p>
      <Link href="/">Back to start</Link>
    </div>
  );
}
