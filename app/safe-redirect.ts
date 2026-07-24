/**
 * Where to send someone after they sign in or sign up, given a target that came
 * from the URL (`?next=`) and rode a form field through the auth action — the
 * mechanism that lets an invite link survive the trip through sign-up (D2).
 *
 * Because that target is user-controlled, only a path *within this app* is
 * honoured: it must start with a single `/`, and carry no whitespace or control
 * characters that a browser would normalise away. Anything else — an absolute URL,
 * a protocol-relative `//host`, its `/\host` twin, a bare relative path — falls
 * back, so the sign-in page can never be turned into an open redirect.
 */
export function safeRedirectPath(
  target: FormDataEntryValue | string | null | undefined,
  fallback: string,
): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\s\u0000-\u001f\u007f]/.test(target)) return fallback;
  return target;
}
