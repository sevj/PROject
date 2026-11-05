"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { clearResponses, deleteRequest, listResponses, type ResponseView, type SendResult, sendRequest } from "@/server/http-requests";

const ids = (projectId: unknown, requestId: unknown) => Number.isInteger(projectId) && Number.isInteger(requestId);

export async function removeHttpRequest(projectId: number, requestId: number): Promise<void> {
  if (!ids(projectId, requestId)) return;
  deleteRequest(getDb(), projectId, requestId);
  revalidatePath(`/projects/${projectId}`);
}

/** `environmentId` null is Local. `confirmed` only counts for a protected environment. */
export async function sendHttpRequest(projectId: number, requestId: number, environmentId: number | null, confirmed: boolean): Promise<SendResult> {
  if (!ids(projectId, requestId) || (environmentId !== null && !Number.isInteger(environmentId))) return { problem: "requestMissing" };
  return sendRequest(getDb(), projectId, requestId, environmentId, confirmed === true);
}

export async function loadHttpResponses(projectId: number, requestId: number): Promise<ResponseView[]> {
  return ids(projectId, requestId) ? listResponses(getDb(), projectId, requestId) : [];
}

export async function clearHttpResponses(projectId: number, requestId: number): Promise<void> {
  if (ids(projectId, requestId)) clearResponses(getDb(), projectId, [requestId]);
}
