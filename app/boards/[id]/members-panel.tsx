"use client";

import { useEffect, useState, useTransition } from "react";
import type { BoardMemberProfile } from "@/db/boards";
import type { BoardRole } from "@/db/schema";
import { Avatar, displayName } from "./avatar";
import {
  changeMemberRoleAction,
  createInviteAction,
  removeMemberAction,
} from "./actions";

/** A live invite as the board page serves it — `expiresAt` arrives ISO-formatted. */
export type PendingInvite = {
  id: string;
  email: string;
  role: BoardRole;
  token: string;
  expiresAt: string;
};

const inputClass =
  "rounded-lg border border-black/15 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

/** A short, locale-formatted expiry date for an invite. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The invite link for a token, absolute so it can be pasted into a chat. The origin
 * is only known in the browser, so it's filled in after mount — the link renders
 * as a bare path for the first paint.
 */
function useInviteLink(): (token: string) => string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (token: string) => `${origin}/invite/${token}`;
}

/** A read-only link field with a copy button — how every invite gets shared (D2). */
function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the field is selectable either way.
    }
  }

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={link}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
      />
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/20"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * The board's people, and — for an owner — the controls to change who they are
 * (D1: only owners invite, remove, and set roles). Inviting mints a link the owner
 * shares out-of-band; live links stay listed so they can be re-copied. Every
 * mutation routes through an owner-checked server action, so this panel decides
 * what to *offer*, never what is *permitted*.
 *
 * The board's creator is shown without controls: their owner row is what keeps the
 * board governed, so it can't be removed or demoted (D5 — no ownership transfer).
 */
export function MembersPanel({
  boardId,
  members,
  invites,
  creatorId,
  currentUserId,
  isOwner,
}: {
  boardId: string;
  members: BoardMemberProfile[];
  invites: PendingInvite[];
  creatorId: string;
  currentUserId: string;
  isOwner: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoardRole>("member");
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inviteLink = useInviteLink();

  function invite(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createInviteAction({ boardId, email, role });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setEmail("");
      setMinted(result?.token ?? null);
    });
  }

  function remove(member: BoardMemberProfile) {
    if (!confirm(`Remove ${displayName(member)} from this board?`)) return;
    startTransition(async () => {
      const result = await removeMemberAction({ boardId, userId: member.id });
      setError(result?.error ?? null);
    });
  }

  function setMemberRole(member: BoardMemberProfile, next: BoardRole) {
    startTransition(async () => {
      const result = await changeMemberRoleAction({
        boardId,
        userId: member.id,
        role: next,
      });
      setError(result?.error ?? null);
    });
  }

  return (
    <details className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/15">
      <summary className="cursor-pointer text-sm font-medium">
        Members ({members.length})
      </summary>

      <ul className="mt-3 space-y-2">
        {members.map((member) => {
          const isCreator = member.id === creatorId;
          return (
            <li key={member.id} className="flex items-center gap-2 text-sm">
              <Avatar user={member} size={24} />
              <span className="min-w-0 flex-1 truncate">
                {displayName(member)}
                {member.id === currentUserId && (
                  <span className="opacity-50"> (you)</span>
                )}
              </span>

              {isOwner && !isCreator ? (
                <>
                  <select
                    value={member.role}
                    disabled={pending}
                    onChange={(e) => setMemberRole(member, e.target.value as BoardRole)}
                    aria-label={`Role for ${displayName(member)}`}
                    className={`${inputClass} py-1`}
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => remove(member)}
                    disabled={pending}
                    className="rounded-lg border border-black/15 px-2 py-1 text-xs font-medium hover:text-red-600 disabled:opacity-40 dark:border-white/20 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-xs capitalize opacity-60">
                  {isCreator ? "Owner · creator" : member.role}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner && (
        <div className="mt-4 space-y-3 border-t border-black/10 pt-3 dark:border-white/10">
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              aria-label="Invite email"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as BoardRole)}
              aria-label="Invite role"
              className={inputClass}
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {pending ? "…" : "Invite"}
            </button>
          </form>

          {minted && (
            <div className="space-y-1">
              <p className="text-xs opacity-60">
                Share this link with them — it works once, and expires in 7 days.
              </p>
              <InviteLink link={inviteLink(minted)} />
            </div>
          )}

          {invites.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold opacity-60">Pending invites</h3>
              <ul className="space-y-2">
                {invites.map((pendingInvite) => (
                  <li key={pendingInvite.id} className="space-y-1">
                    <p className="text-xs opacity-70">
                      {pendingInvite.email} · {pendingInvite.role} · expires{" "}
                      {formatDate(pendingInvite.expiresAt)}
                    </p>
                    <InviteLink link={inviteLink(pendingInvite.token)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </details>
  );
}
