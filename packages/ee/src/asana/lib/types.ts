import { z } from "zod";

export const AsanaTaskSchema = z.object({
  gid: z.string(),
  name: z.string(),
  notes: z.string().nullish(),
  html_notes: z.string().nullish(),
  completed: z.boolean(),
  assignee: z
    .object({
      gid: z.string(),
      name: z.string(),
      email: z.string()
    })
    .nullish(),
  due_on: z.string().nullish(),
  permalink_url: z.string(),
  projects: z
    .array(
      z.object({
        gid: z.string(),
        name: z.string()
      })
    )
    .default([])
});

export type AsanaTask = z.infer<typeof AsanaTaskSchema>;

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
}

export interface AsanaUser {
  gid: string;
  email: string;
  name: string;
}
