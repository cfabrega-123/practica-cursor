import { supabase } from "@/lib/supabaseClient";
import type { PostgrestError } from "@supabase/supabase-js";

export type GameRound = {
  id: string;
  session_id: string;
  round_number: number;
  status: string;
  pack_id: string | null;
  impostor_count: number;
  chosen_item_id: string | null;
  started_at?: string | null;
  ended_at: string | null;
};

export type ActivePlayer = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type RoundAssignment = {
  id: string;
  round_id: string;
  session_player_id: string;
  role: string;
  revealed_at: string | null;
  created_at: string;
};

export async function getRound(roundId: string): Promise<{ data: GameRound | null; error: PostgrestError | null }> {
  const res = await supabase
    .from("game_rounds")
    .select("id,session_id,round_number,status,pack_id,impostor_count,chosen_item_id,started_at,ended_at")
    .eq("id", roundId)
    .single();

  if (res.error) return { data: null, error: res.error };
  const r = res.data as GameRound;
  return { data: r, error: null };
}

export async function getPackName(
  packId: string | null
): Promise<{ data: string | null; error: PostgrestError | null }> {
  if (!packId) return { data: null, error: null };
  const res = await supabase.from("packs").select("name").eq("id", packId).single();
  return { data: res.data?.name ?? null, error: res.error };
}

export async function getChosenItemLabel(
  itemId: string | null
): Promise<{ data: string | null; error: PostgrestError | null }> {
  if (!itemId) return { data: null, error: null };
  const res = await supabase.from("pack_items").select("label").eq("id", itemId).single();
  return { data: res.data?.label ?? null, error: res.error };
}

export async function listActivePlayers(
  sessionId: string
): Promise<{ data: ActivePlayer[]; error: PostgrestError | null }> {
  const res = await supabase
    .from("game_session_players")
    .select("id,name,is_active,created_at")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  return { data: (res.data ?? []) as ActivePlayer[], error: res.error };
}

export async function getAssignments(
  roundId: string
): Promise<{ data: RoundAssignment[]; error: PostgrestError | null }> {
  const res = await supabase
    .from("game_round_assignments")
    .select("id,round_id,session_player_id,role,revealed_at,created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  return { data: (res.data ?? []) as RoundAssignment[], error: res.error };
}

export async function markRevealed(
  assignmentId: string
): Promise<{ data: { id: string; revealed_at: string | null } | null; error: PostgrestError | null }> {
  const res = await supabase
    .from("game_round_assignments")
    .update({ revealed_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .select("id,revealed_at")
    .single();
  if (res.error) return { data: null, error: res.error };
  const row = res.data as { id: string; revealed_at: string | null };
  return { data: { id: row.id, revealed_at: row.revealed_at ?? null }, error: null };
}

export async function endRound(
  roundId: string
): Promise<{ data: { id: string; status: string; ended_at: string | null } | null; error: PostgrestError | null }> {
  const res = await supabase
    .from("game_rounds")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", roundId)
    .select("id,status,ended_at")
    .single();
  if (res.error) return { data: null, error: res.error };
  const row = res.data as { id: string; status: string; ended_at: string | null };
  return {
    data: {
      id: row.id,
      status: row.status,
      ended_at: row.ended_at ?? null,
    },
    error: null,
  };
}

export async function deleteRound(
  roundId: string
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  // Prefer relying on FK cascade from game_round_assignments -> game_rounds.
  // If your DB doesn't have cascade, we'll try deleting assignments first.
  const del = await supabase.from("game_rounds").delete().eq("id", roundId).select("id").single();
  if (!del.error) return { data: { id: del.data.id as string }, error: null };

  const msg = String(del.error.message ?? "").toLowerCase();
  if (msg.includes("violates foreign key") || msg.includes("foreign key")) {
    await supabase.from("game_round_assignments").delete().eq("round_id", roundId);
    const del2 = await supabase.from("game_rounds").delete().eq("id", roundId).select("id").single();
    if (del2.error) return { data: null, error: del2.error };
    return { data: { id: del2.data.id as string }, error: null };
  }

  return { data: null, error: del.error };
}

