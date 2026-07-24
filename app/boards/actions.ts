"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createBoard, createBoardSchema } from "@/db/boards";

export type CreateBoardState = { error: string } | undefined;

/**
 * Create a board owned by the signed-in user. Zod-validates the name at the
 * boundary and derives the owner from the session (never from client input), so
 * a caller can only ever create a board for themselves. `createBoard` makes them
 * the `owner` member in the same transaction.
 */
export async function createBoardAction(
  _prev: CreateBoardState,
  formData: FormData,
): Promise<CreateBoardState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const parsed = createBoardSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid board name." };
  }

  await createBoard({ name: parsed.data.name, ownerId: session.user.id });
  revalidatePath("/boards");
}
