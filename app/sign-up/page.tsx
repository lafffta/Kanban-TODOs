import Link from "next/link";
import { signUpAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function SignUpPage() {
  return (
    <AuthForm
      title="Create account"
      subtitle="Start tracking work on shared boards."
      action={signUpAction}
      submitLabel="Create account"
      showName
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium underline">
            Sign in
          </Link>
        </>
      }
    />
  );
}
