"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/prisma";
import type { WorkspaceUser, WorkspaceData } from "@/types/workspace";

export type { WorkspaceUser, WorkspaceData } from "@/types/workspace";

// ─── Get the current authenticated user ──────────────────────────────────────

export async function getWorkspaceUser(): Promise<WorkspaceUser> {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/");

  const user = await db.user.findUnique({
    where: { clerkId },
    select: { id: true, credits: true, plan: true },
  });

  if (!user) redirect("/");

  return user;
}

// ─── Get a workspace by id (must belong to the current user) ─────────────────
// This is a Server Function ('use server' export), so it's independently
// callable by its action ID — not just from workspace/page.tsx. It must not
// trust a caller-supplied userId; it derives the user from the session
// itself, the same way getWorkspaceUser() above does. See:
// https://clerk.com/docs/guides/development/deprecating-middleware-auth

export async function getWorkspaceById(
  workspaceId: string,
): Promise<WorkspaceData> {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/");

  const user = await db.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) redirect("/");

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId, userId: user.id },
    select: {
      id: true,
      title: true,
      messages: true,
      fileData: true,
    },
  });

  if (!workspace) redirect("/");

  return workspace;
}
