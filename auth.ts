import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authorizeCredentials } from "@/db/auth";
import { db } from "@/db/index";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

/**
 * Auth.js v5 configuration. Credentials provider + JWT session strategy
 * (Credentials requires JWT). The Drizzle adapter is wired for the reserved
 * OAuth tables; the JWT flow carries the user id on the token/session so callers
 * can identify the signed-in user without a DB session row.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: (raw) => authorizeCredentials(raw),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
