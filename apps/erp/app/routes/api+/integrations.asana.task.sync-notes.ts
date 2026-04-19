import { requirePermissions } from "@carbon/auth/auth.server";
import type { TiptapDocument } from "@carbon/ee/asana";
import {
  getAsanaClient,
  getAsanaTaskFromExternalId,
  tiptapToHtml
} from "@carbon/ee/asana.server";
import type { ActionFunction } from "react-router";
import { data } from "react-router";

const asana = getAsanaClient();

export const action: ActionFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  if (request.method !== "POST") {
    return data({ success: false, message: "Method not allowed" }, 405);
  }

  const form = await request.formData();
  const actionId = form.get("actionId") as string;
  const notesStr = form.get("notes") as string;

  if (!actionId) {
    return data({ success: false, message: "Missing actionId" }, 400);
  }

  let notes: TiptapDocument | null = null;
  try {
    notes = notesStr ? JSON.parse(notesStr) : null;
  } catch {
    return data({ success: false, message: "Invalid notes format" }, 400);
  }

  const task = await getAsanaTaskFromExternalId(client, companyId, actionId);

  if (!task) {
    return { success: true, message: "No linked Asana task" };
  }

  if (!notes) {
    return { success: true, message: "No notes to sync" };
  }

  try {
    const html_notes = tiptapToHtml(notes);

    await asana.updateTask(companyId, task.gid, {
      html_notes
    });

    return { success: true, message: "Notes synced to Asana" };
  } catch (error) {
    console.error("Failed to sync notes to Asana:", error);
    return data(
      { success: false, message: "Failed to sync notes to Asana" },
      500
    );
  }
};
