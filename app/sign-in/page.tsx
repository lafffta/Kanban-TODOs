import Link from "next/link";
import { signInAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function SignInPage() {
  return (
    <AuthForm
      title="Sign in"
      subtitle="Welcome back to Kanban Task Tracker."
      action={signInAction}
      submitLabel="Sign in"
      footer={
        <>
          No account?{" "}
          <Link href="/sign-up" className="font-medium underline">
            Create one
          </Link>
        </>
      }
    />
  );
}
