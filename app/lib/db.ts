import { supabase } from "./supabaseClient";
import type { ProjectRow, TaskRow } from "./types";

export async function getSessionOrNull() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

/* ---------------- Projects ---------------- */

export async function listProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,description,owner_id")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function createProject(ownerId: string, name: string) {
  const { error } = await supabase.from("projects").insert({
    owner_id: ownerId,
    name,
    description: null,
  });
  if (error) throw error;
}

export async function renameProject(projectId: string, name: string) {
  const { error } = await supabase.from("projects").update({ name }).eq("id", projectId);
  if (error) throw error;
}

export async function deleteProject(projectId: string) {
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

/* ---------------- Tasks ---------------- */

export async function listTasks(projectId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,project_id,owner_id,title,details,status,due_date")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

export async function createTask(params: {
  projectId: string;
  ownerId: string;
  title: string;
}) {
  const { error } = await supabase.from("tasks").insert({
    project_id: params.projectId,
    owner_id: params.ownerId,
    title: params.title,
    details: null,
    status: "todo",
    due_date: null,
  });
  if (error) throw error;
}

export async function updateTaskStatus(taskId: string, status: "todo" | "doing" | "done") {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) throw error;
}

export async function deleteTask(taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}
