import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { users, type User } from "./schema";

/** Public shape of a user — never carries the password hash. */
export type PublicUser = Omit<User, "passwordHash">;

function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  return rest;
}

/** Create an account with an argon2-hashed password. Email must be unique. */
export async function registerUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<PublicUser> {
  const passwordHash = await hash(input.password);
  const [row] = await db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash })
    .returning();
  return toPublicUser(row);
}

/**
 * Verify an email + password against the stored argon2 hash. Returns the user on
 * success, or null if the email is unknown, has no password, or the password is
 * wrong.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<PublicUser | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.passwordHash) return null;
  const ok = await verify(row.passwordHash, password);
  return ok ? toPublicUser(row) : null;
}

/** Zod shape for the Credentials sign-in inputs. */
export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Validate raw Credentials-provider input and authenticate it. Returns the user
 * on success, or null on malformed input or a failed credential check — the
 * contract Auth.js's `authorize` callback expects (null = reject).
 */
export async function authorizeCredentials(raw: unknown): Promise<PublicUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  return verifyCredentials(parsed.data.email, parsed.data.password);
}

/** Zod shape for sign-up. Enforces a real password length, unlike sign-in. */
export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().trim().min(1).optional(),
});

export type CreateAccountResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: string };

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the driver error, so the pg code "23505" may sit on `.cause`.
  for (let e: unknown = err; e != null; e = (e as { cause?: unknown }).cause) {
    if (typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505") {
      return true;
    }
  }
  return false;
}

/**
 * Validate sign-up input and create the account. Returns a discriminated result
 * so callers (server actions) get a friendly message instead of a thrown Zod or
 * unique-constraint error. The DB unique constraint is the source of truth for
 * duplicate emails.
 */
export async function createAccount(raw: unknown): Promise<CreateAccountResult> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const user = await registerUser(parsed.data);
    return { ok: true, user };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That email is already registered." };
    }
    throw err;
  }
}
