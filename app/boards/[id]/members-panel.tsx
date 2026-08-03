"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BoardMemberProfile } from "@/db/boards";
import type { BoardRole } from "@/db/schema";
import { useOfflineWriteGate } from "@/app/pwa/offline-write-gate";
import { useBoard } from "./board-context";
import { canManageMember } from "./membership";
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
 * Refresh the server-rendered half of the board page when the viewer's own role
 * changes under them (ticket 17).
 *
 * The polled payload carries the membership, so the panel's own controls follow a
 * promotion or demotion by themselves. What it cannot carry is the *invite tokens*:
 * they are owner-only (D2/D6), so `/api/boards/:id` — which every member reads —
 * must never include them, and the page fetches them server-side under the role the
 * viewer held at render. A newly promoted owner would otherwise see an empty
 * pending-invite list until they reloaded. Re-running the server render is what
 * fills it in, and is equally what drops it again on demotion.
 *
 * It watches the viewer's *own* role only, so a busy board's other promotions cost
 * nothing. Should that role go to null — the viewer is off the board entirely — the
 * re-render's `requireBoardMember` throws and `redirectOnBoardDenial` sends them to
 * their boards list, which is the right end for someone who was removed.
 */
function useRefreshOnRoleChange(role: BoardRole | null): void {
  const router = useRouter();
  const previous = useRef(role);
  useEffect(() => {
    if (previous.current === role) return;
    previous.current = role;
    router.refresh();
  }, [role, router]);
}

/**
 * The board's people, and — for an owner — the controls to change who they are
 * (D1: only owners invite, remove, and set roles). Inviting mints a link the owner
 * shares out-of-band; live links stay listed so they can be re-copied. Every
 * mutation routes through an owner-checked server action, so this panel decides
 * what to *offer*, never what is *permitted*.
 *
 * Who is here, and whether the viewer governs them, are read from the board's live
 * membership projection — the same one the assignee picker and the card sheet use
 * (ticket 17). So an owner's promotion of a teammate reaches that teammate's own
 * panel within a polling interval, and a demotion takes their controls away again,
 * with no reload on either side. `invites` stays a server-rendered prop because
 * tokens can't travel in the payload every member polls.
 *
 * The board's creator is shown without controls: their owner row is what keeps the
 * board governed, so it can't be removed or demoted (D5 — no ownership transfer).
 */
export function MembersPanel({ invites }: { invites: PendingInvite[] }) {
  const { boardId, currentUserId, membership } = useBoard();
  const { members, isOwner } = membership;
  useRefreshOnRoleChange(membership.role);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoardRole>("member");
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inviteLink = useInviteLink();
  // Governance writes don't go through the board's `run`, so they carry the
  // offline gate themselves — offline, every mutation is refused (D8).
  const refuseWhileOffline = useOfflineWriteGate();

  function invite(event: React.FormEvent) {
    event.preventDefault();
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
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
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
    if (!confirm(`Remove ${displayName(member)} from this board?`)) return;
    startTransition(async () => {
      const result = await removeMemberAction({ boardId, userId: member.id });
      setError(result?.error ?? null);
    });
  }

  function setMemberRole(member: BoardMemberProfile, next: BoardRole) {
    const refused = refuseWhileOffline();
    if (refused) return setError(refused);
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
    // Opened, the panel takes at most half the board's height and scrolls; a board
    // with a long member list shouldn't push the lanes off a phone screen.
    <details className="max-h-[50%] shrink-0 overflow-y-auto rounded-xl border border-black/10 px-4 py-3 dark:border-white/15">
      <summary className="cursor-pointer text-sm font-medium">
        Members ({members.length})
      </summary>

      <ul className="mt-3 space-y-2">
        {members.map((member) => {
          const isCreator = member.id === membership.creatorId;
          return (
            <li key={member.id} className="flex items-center gap-2 text-sm">
              <Avatar user={member} size={24} />
              <span className="min-w-0 flex-1 truncate">
                {displayName(member)}
                {member.id === currentUserId && (
                  <span className="opacity-50"> (you)</span>
                )}
              </span>

              {canManageMember(membership, member.id) ? (
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
