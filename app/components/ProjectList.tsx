"use client";

import type { ProjectRow } from "../lib/types";

export function ProjectList(props: {
  projects: ProjectRow[];
  onOpen: (projectId: string) => void;
  onRename: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}) {
  const { projects, onOpen, onRename, onDelete } = props;

  return (
    <section>
      <h2>Mis Projects (RLS)</h2>

      <ul>
        {projects.map((p) => (
          <li key={p.id} style={{ marginBottom: 10 }}>
            <div>
              <b>{p.name}</b>
            </div>

            <div style={{ fontSize: 12, color: "#666" }}>{p.id}</div>

            <div style={{ fontSize: 12, color: "#666" }}>
              owner_id: {p.owner_id}
            </div>

            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => onRename(p.id)}
                style={{ padding: 6, fontSize: 12 }}
              >
                Rename
              </button>

              <button
                onClick={() => onDelete(p.id)}
                style={{ padding: 6, fontSize: 12, marginLeft: 8 }}
              >
                Delete
              </button>

              <button
                onClick={() => onOpen(p.id)}
                style={{ padding: 6, fontSize: 12, marginLeft: 8 }}
              >
                Open
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
