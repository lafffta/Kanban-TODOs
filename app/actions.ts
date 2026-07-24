"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { createAccount } from "@/db/auth";

export type AuthActionState = { error: string } | undefined;

const PROTECTED_HOME = "/boards";

/**
 * Sign in via the Credentials provider, redirecting to the protected home on
 * success. `signIn` with `redirectTo` throws NEXT_REDIRECT on success (which must
 * propagate); a failed credential check throws an `AuthError` of type
 * `CredentialsSignin`, which we turn into `failureMessage`. Any other error
 * (e.g. a misconfiguration) is rethrown rather than masked.
 */
async function attemptSignIn(
  email: FormDataEntryValue | null,
  password: FormDataEntryValue | null,
  failureMessage: string,
): Promise<AuthActionState> {
  try {
    await signIn("credentials", { email, password, redirectTo: PROTECTED_HOME });
  } catch (err) {
    if (err instanceof AuthError && err.type === "CredentialsSignin") {
      return { error: failureMessage };
    }
    throw err;
  }
}

/** Sign up, then sign the new user in on success. */
export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const nameValue = formData.get("name");

  const result = await createAccount({
    email,
    password,
    name: typeof nameValue === "string" && nameValue.trim() ? nameValue : undefined,
  });
  if (!result.ok) return { error: result.error };

  return attemptSignIn(
    email,
    password,
    "Account created, but sign-in failed. Please sign in.",
  );
}

/** Sign in with credentials. Rejects invalid credentials with a friendly error. */
export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return attemptSignIn(
    formData.get("email"),
    formData.get("password"),
    "Invalid email or password.",
  );
}
