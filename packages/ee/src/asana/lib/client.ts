import { getCarbonServiceRole } from "@carbon/auth/client.server";
import axios, { type AxiosInstance } from "axios";
import { getAsanaIntegration } from "./service";
import type {
  AsanaProject,
  AsanaTask,
  AsanaUser,
  AsanaWorkspace
} from "./types";

const OPT_FIELDS_TASK =
  "gid,name,notes,html_notes,completed,assignee,assignee.email,assignee.name,due_on,permalink_url,projects,projects.name";

export class AsanaClient {
  instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: "https://app.asana.com/api/1.0",
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async getAuthHeaders(companyId: string) {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getAsanaIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("Asana integration not found for company");
    }

    const metadata = integration.metadata as { accessToken: string };

    return {
      Authorization: `Bearer ${metadata.accessToken}`
    };
  }

  async healthcheck(companyId: string) {
    try {
      const response = await this.instance.get("/users/me", {
        headers: await this.getAuthHeaders(companyId)
      });
      return response.status === 200 && !!response.data?.data?.gid;
    } catch {
      return false;
    }
  }

  async listWorkspaces(companyId: string): Promise<AsanaWorkspace[]> {
    try {
      const response = await this.instance.get<{
        data: AsanaWorkspace[];
      }>("/workspaces", {
        headers: await this.getAuthHeaders(companyId)
      });
      return response.data.data;
    } catch (error) {
      console.error("Error listing Asana workspaces:", error);
      return [];
    }
  }

  async listProjects(
    companyId: string,
    workspaceGid: string
  ): Promise<AsanaProject[]> {
    try {
      const response = await this.instance.get<{
        data: AsanaProject[];
      }>("/projects", {
        headers: await this.getAuthHeaders(companyId),
        params: { workspace: workspaceGid, opt_fields: "gid,name" }
      });
      return response.data.data;
    } catch (error) {
      console.error("Error listing Asana projects:", error);
      return [];
    }
  }

  async searchTasks(
    companyId: string,
    workspaceGid: string,
    query: string
  ): Promise<AsanaTask[]> {
    try {
      const response = await this.instance.get<{
        data: Array<{ gid: string; name: string }>;
      }>(`/workspaces/${workspaceGid}/typeahead`, {
        headers: await this.getAuthHeaders(companyId),
        params: { type: "task", query, count: 10, opt_fields: "gid,name" }
      });

      // Fetch full details for each result
      const tasks = await Promise.all(
        response.data.data.map((t) => this.getTaskById(companyId, t.gid))
      );
      return tasks.filter((t): t is AsanaTask => t !== null);
    } catch (error) {
      console.error("Error searching Asana tasks:", error);
      return [];
    }
  }

  async getTaskById(
    companyId: string,
    taskGid: string
  ): Promise<AsanaTask | null> {
    try {
      const response = await this.instance.get<{ data: AsanaTask }>(
        `/tasks/${taskGid}`,
        {
          headers: await this.getAuthHeaders(companyId),
          params: { opt_fields: OPT_FIELDS_TASK }
        }
      );
      return response.data.data;
    } catch (error) {
      console.error("Error getting Asana task:", error);
      return null;
    }
  }

  async createTask(
    companyId: string,
    data: {
      name: string;
      html_notes?: string;
      projects?: string[];
      assignee?: string | null;
      due_on?: string | null;
      completed?: boolean;
      workspace: string;
    }
  ): Promise<AsanaTask | null> {
    try {
      const response = await this.instance.post<{ data: AsanaTask }>(
        "/tasks",
        { data },
        {
          headers: await this.getAuthHeaders(companyId),
          params: { opt_fields: OPT_FIELDS_TASK }
        }
      );
      return response.data.data;
    } catch (error) {
      console.error("Error creating Asana task:", error);
      return null;
    }
  }

  async updateTask(
    companyId: string,
    taskGid: string,
    data: {
      name?: string;
      html_notes?: string;
      completed?: boolean;
      assignee?: string | null;
      due_on?: string | null;
    }
  ): Promise<AsanaTask | null> {
    try {
      const response = await this.instance.put<{ data: AsanaTask }>(
        `/tasks/${taskGid}`,
        { data },
        {
          headers: await this.getAuthHeaders(companyId),
          params: { opt_fields: OPT_FIELDS_TASK }
        }
      );
      return response.data.data;
    } catch (error) {
      console.error("Error updating Asana task:", error);
      return null;
    }
  }

  async createWebhook(
    companyId: string,
    data: { resource: string; target: string }
  ): Promise<{ gid: string } | null> {
    try {
      const response = await this.instance.post<{ data: { gid: string } }>(
        "/webhooks",
        { data },
        { headers: await this.getAuthHeaders(companyId) }
      );
      return response.data.data;
    } catch (error) {
      console.error("Error creating Asana webhook:", error);
      return null;
    }
  }

  async deleteWebhook(companyId: string, webhookGid: string): Promise<boolean> {
    try {
      await this.instance.delete(`/webhooks/${webhookGid}`, {
        headers: await this.getAuthHeaders(companyId)
      });
      return true;
    } catch (error) {
      console.error("Error deleting Asana webhook:", error);
      return false;
    }
  }

  async getWorkspaceUsers(
    companyId: string,
    workspaceGid: string
  ): Promise<AsanaUser[]> {
    try {
      const response = await this.instance.get<{
        data: AsanaUser[];
      }>("/users", {
        headers: await this.getAuthHeaders(companyId),
        params: { workspace: workspaceGid, opt_fields: "gid,email,name" }
      });
      return response.data.data;
    } catch (error) {
      console.error("Error listing Asana workspace users:", error);
      return [];
    }
  }
}

let instance: AsanaClient | null = null;

export const getAsanaClient = () => {
  if (!instance) instance = new AsanaClient();
  return instance;
};
