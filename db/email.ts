import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Email identity, in one place.
 *
 * An email address names a person, not a string: `Ada@Example.com`,
 * `ada@example.com` and a copy-pasted ` ada@example.com ` are all the same
 * account. Every boundary that turns typed text into an identity — sign-up,
 * sign-in, minting an invite, matching one — funnels through `canonicalEmail`,
 * and the database holds the same invariant with a unique index on
 * `lower(email)` so a writer that skips these seams still can't mint a second
 * identity for one address.
 *
 * Canonical form is what we *store*, so the display text and the identity are
 * the same string. There is no separate "as typed" copy to drift out of sync.
 */

/** The stored, comparable form of an address: trimmed and lowercased. */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The canonical form of an email column, computed *in SQL*. Stored addresses are
 * already canonical, so this exists for the writers that bypass our seams (the
 * Auth.js adapter's future OAuth rows, an ad-hoc script): folding the stored side
 * too means a query matches the account regardless. It also matches the
 * expression behind the unique index, so lookups stay indexed.
 */
export function canonicalEmailSql(column: AnyColumn): SQL<string> {
  return sql<string>`lower(${column})`;
}
