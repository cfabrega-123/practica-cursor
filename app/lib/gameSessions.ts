import { supabase } from "./supabaseClient";

export type GameSession = {
  id: string;
  title?: string | null;
  created_at: string;
};

export async function listGameSessions() {
  const withTitle = await supabase
    .from("game_sessions")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  // Compat: si la DB todavía no tiene `title`, hacemos fallback sin esa columna.
  if (withTitle.error) {
    const msg = String(withTitle.error.message ?? "").toLowerCase();
    if (msg.includes("title") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return supabase
        .from("game_sessions")
        .select("id, created_at")
        .order("created_at", { ascending: false });
    }
  }

  return withTitle;
}

export async function createGameSession(title: string) {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) throw new Error("No session");

  const withTitle = await supabase
    .from("game_sessions")
    .insert({
      owner_id: userId,
      title,
    })
    .select()
    .single();

  // Compat: si `title` no existe en la tabla, reintentar sin `title`.
  if (withTitle.error) {
    const msg = String(withTitle.error.message ?? "").toLowerCase();
    if (msg.includes("title") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
      return supabase
        .from("game_sessions")
        .insert({
          owner_id: userId,
        })
        .select()
        .single();
    }

    // Hint si la tabla viene del SQL viejo con pack_id NOT NULL
    if (msg.includes("pack_id") && msg.includes("null") && msg.includes("not-null")) {
      throw new Error(
        "Tu DB requiere `pack_id` para crear una sesión. Aplica `db/sql/006_game_sessions_make_title_optional_pack.sql`."
      );
    }
  }

  return withTitle;
}

export async function deleteGameSession(id: string) {
  return supabase.from("game_sessions").delete().eq("id", id);
}
