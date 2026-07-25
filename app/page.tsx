import { redirect } from "next/navigation";

// The root route is the app's front door: send visitors into the product.
// /boards is itself session-gated and redirects to /sign-in when logged out,
// so this single redirect covers both the signed-in and signed-out cases.
export default function Home() {
  redirect("/boards");
}
