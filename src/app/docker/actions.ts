"use server";

import { revalidatePath } from "next/cache";
import type { OverviewAction } from "@/lib/docker-overview";
import { actOnContainers } from "@/server/docker-overview";

const ACTIONS: readonly string[] = ["start", "stop", "restart"];

export async function actOnDockerContainers(action: string, ids: string[]): Promise<{ done: number } | { error: string }> {
  if (!ACTIONS.includes(action) || !Array.isArray(ids)) return { error: "unknown action" };
  const result = await actOnContainers(action as OverviewAction, ids.filter((id) => typeof id === "string"));
  revalidatePath("/docker");
  revalidatePath("/");
  return result;
}
