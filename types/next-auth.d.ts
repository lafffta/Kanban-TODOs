import type { DefaultSession } from "next-auth";

// Carry the user id through the JWT session so server code can identify the
// signed-in user (set in the jwt/session callbacks in auth.ts).
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
