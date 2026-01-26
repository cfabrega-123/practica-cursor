"use client";

import type { TaskRow } from "../lib/types";

export function TaskPanel(props: {
  selectedProjectId: string | null;
  tasks: TaskRow[];
  newTaskTitle: string;
  setNewTaskTitle: (v: string) => void;
  onCreateTask: () => void;
  onUpdateStatus: (taskId: string, status: "todo" | "doing" | "done") => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const {
    selectedProjectId,
    tasks,
    newTaskTitle,
    setNewTaskTitle,
    onCreateTask,
    onUpdateStatus,
    onDeleteTask,
  } = props;

  return (
    <section>
      <hr style={{ margin: "20px 0" }} />
      <h2>Tasks</h2>

      {!selectedProjectId ? (
        <p style={{ color: "#555" }}>Selecciona un project con “Open”.</p>
      ) : (
        <>
          <p style={{ color: "#555" }}>
            Project seleccionado: <code>{selectedProjectId}</code>
          </p>

          <h3>Crear Task</h3>
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Título de la task"
            style={{ width: "100%", padding: 10, fontSize: 14 }}
          />
          <button
            onClick={onCreateTask}
            style={{ marginTop: 12, padding: 10, fontSize: 14 }}
          >
            Crear Task
          </button>

          <h3 style={{ marginTop: 20 }}>Lista</h3>
          <ul>
            {tasks.map((t) => (
              <li key={t.id} style={{ marginBottom: 10 }}>
                <div>
                  <b>{t.title}</b>{" "}
                  <span style={{ color: "#666" }}>({t.status})</span>
                </div>

                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => onUpdateStatus(t.id, "todo")}
                    style={{ padding: 6, fontSize: 12 }}
                  >
                    todo
                  </button>
                  <button
                    onClick={() => onUpdateStatus(t.id, "doing")}
                    style={{ padding: 6, fontSize: 12, marginLeft: 6 }}
                  >
                    doing
                  </button>
                  <button
                    onClick={() => onUpdateStatus(t.id, "done")}
                    style={{ padding: 6, fontSize: 12, marginLeft: 6 }}
                  >
                    done
                  </button>

                  <button
                    onClick={() => onDeleteTask(t.id)}
                    style={{ padding: 6, fontSize: 12, marginLeft: 12 }}
                  >
                    delete
                  </button>
                </div>

                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  {t.id}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
