export type ProjectRow = {
    id: string;
    name: string;
    description: string | null;
    owner_id: string;
  };
  
  export type TaskRow = {
    id: string;
    project_id: string;
    owner_id: string;
    title: string;
    details: string | null;
    status: "todo" | "doing" | "done" | string;
    due_date: string | null;
  };
  
