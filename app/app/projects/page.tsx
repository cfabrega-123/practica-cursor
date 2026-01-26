"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";

import type { ProjectRow, TaskRow } from "../../lib/types";
import {
  listProjects,
  createProject as dbCreateProject,
  renameProject as dbRenameProject,
  deleteProject as dbDeleteProject,
  listTasks,
  createTask as dbCreateTask,
  updateTaskStatus as dbUpdateTaskStatus,
  deleteTask as dbDeleteTask,
} from "../../lib/db";

import { ProjectList } from "../../components/ProjectList";
import { TaskPanel } from "../../components/TaskPanel";

export default function ProjectsPage() {
  const router = useRouter();

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [newProjectName, setNewProjectName] = useState("");

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (!s) {
        router.replace("/login");
        return;
      }
      setSessionEmail(s.user.email ?? null);
      setUserId(s.user.id);
      void refreshProjects();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setSessionEmail(session.user.email ?? null);
      setUserId(session.user.id);
      void refreshProjects();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshProjects() {
    setErrorMsg(null);
    setLoadingProjects(true);
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error loading projects");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) alert(error.message);
    router.replace("/login");
  }

  async function createProject() {
    if (!userId) return alert("No user session.");
    const name = newProjectName.trim();
    if (!name) return alert("Project name required.");

    setErrorMsg(null);
    try {
      await dbCreateProject(userId, name);
      setNewProjectName("");
      await refreshProjects();
    } catch (e: any) {
      alert(e?.message ?? "Create project failed");
    }
  }

  async function renameProject(projectId: string) {
    const newName = prompt("Nuevo nombre del project:");
    if (!newName?.trim()) return;

    setErrorMsg(null);
    try {
      await dbRenameProject(projectId, newName.trim());
      await refreshProjects();
    } catch (e: any) {
      alert(e?.message ?? "Rename failed");
    }
  }

  async function deleteProject(projectId: string) {
    const ok = confirm("¿Seguro que quieres borrar este project?");
    if (!ok) return;

    setErrorMsg(null);
    try {
      await dbDeleteProject(projectId);

      // si borraste el project abierto, limpia panel de tasks
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setTasks([]);
      }

      await refreshProjects();
    } catch (e: any) {
      alert(e?.message ?? "Delete failed");
    }
  }

  async function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    setNewTaskTitle("");
    setErrorMsg(null);
    setLoadingTasks(true);
    try {
      const data = await listTasks(projectId);
      setTasks(data);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error loading tasks");
    } finally {
      setLoadingTasks(false);
    }
  }

  async function createTask() {
    if (!userId) return alert("No user session.");
    if (!selectedProjectId) return alert("Selecciona un project primero.");
    const title = newTaskTitle.trim();
    if (!title) return alert("Task title required.");

    setErrorMsg(null);
    try {
      await dbCreateTask({ projectId: selectedProjectId, ownerId: userId, title });
      setNewTaskTitle("");
      setLoadingTasks(true);
      const data = await listTasks(selectedProjectId);
      setTasks(data);
    } catch (e: any) {
      alert(e?.message ?? "Create task failed");
    } finally {
      setLoadingTasks(false);
    }
  }

  async function updateStatus(taskId: string, status: "todo" | "doing" | "done") {
    setErrorMsg(null);
    try {
      await dbUpdateTaskStatus(taskId, status);
      if (selectedProjectId) {
        setLoadingTasks(true);
        const data = await listTasks(selectedProjectId);
        setTasks(data);
      }
    } catch (e: any) {
      alert(e?.message ?? "Update task failed");
    } finally {
      setLoadingTasks(false);
    }
  }

  async function deleteTask(taskId: string) {
    const ok = confirm("¿Borrar esta task?");
    if (!ok) return;

    setErrorMsg(null);
    try {
      await dbDeleteTask(taskId);
      if (selectedProjectId) {
        setLoadingTasks(true);
        const data = await listTasks(selectedProjectId);
        setTasks(data);
      }
    } catch (e: any) {
      alert(e?.message ?? "Delete task failed");
    } finally {
      setLoadingTasks(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Projects</h1>

      <p>
        Sesión: <b>{sessionEmail ?? "..."}</b>
      </p>

      <div style={{ marginTop: 12 }}>
        <button onClick={signOut} style={{ padding: 10, fontSize: 14 }}>
          Logout
        </button>
        <button
          onClick={refreshProjects}
          style={{ padding: 10, fontSize: 14, marginLeft: 8 }}
          disabled={loadingProjects}
        >
          {loadingProjects ? "Loading..." : "Refresh"}
        </button>
      </div>

      {errorMsg && (
        <p style={{ marginTop: 12, color: "crimson" }}>
          Error: {errorMsg}
        </p>
      )}

      <hr style={{ margin: "20px 0" }} />

      <h2>Crear Project</h2>
      <input
        value={newProjectName}
        onChange={(e) => setNewProjectName(e.target.value)}
        placeholder="Nombre del project"
        style={{ width: "100%", padding: 10, fontSize: 14 }}
      />
      <button
        onClick={createProject}
        style={{ marginTop: 12, padding: 10, fontSize: 14 }}
      >
        Crear
      </button>

      <hr style={{ margin: "20px 0" }} />

      {loadingProjects ? (
        <p style={{ color: "#555" }}>Cargando projects...</p>
      ) : (
        <ProjectList
          projects={projects}
          onOpen={openProject}
          onRename={renameProject}
          onDelete={deleteProject}
        />
      )}

      {loadingTasks && selectedProjectId && (
        <p style={{ color: "#555" }}>Cargando tasks...</p>
      )}

      <TaskPanel
        selectedProjectId={selectedProjectId}
        tasks={tasks}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        onCreateTask={createTask}
        onUpdateStatus={updateStatus}
        onDeleteTask={deleteTask}
      />
    </main>
  );
}
