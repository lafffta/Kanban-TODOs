import type { UserProfile } from "@/db/schema";

/** The label for a person: their name if they have one, else their email. */
export function displayName(user: Pick<UserProfile, "name" | "email">): string {
  return user.name?.trim() || user.email;
}

/**
 * A small round avatar for a user: their photo when present, otherwise initials
 * derived from `displayName`. Purely presentational (no hooks), so it renders on
 * the card face and inside the assignee picker alike.
 */
export function Avatar({
  user,
  size = 24,
  title,
}: {
  user: UserProfile;
  size?: number;
  title?: string;
}) {
  const label = title ?? displayName(user);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (user.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt={label}
        title={label}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={style}
      />
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-black/10 font-semibold uppercase text-black/70 dark:bg-white/15 dark:text-white/80"
    >
      {initials(user)}
    </span>
  );
}

/** Up to two initials from a user's `displayName` (name words, else email). */
function initials(user: UserProfile): string {
  const source = displayName(user);
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
