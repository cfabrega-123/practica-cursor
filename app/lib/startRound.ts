import { supabase } from "@/lib/supabaseClient";
import type { PostgrestError } from "@supabase/supabase-js";

export const IMPOSTOR_START_WEIGHT = 0.05;

export type StartRoundParams = {
  sessionId: string;
  roundId: string;
  impostorCount: number;
  /**
   * Si ya existen assignments:
   * - false/undefined: no hace nada (idempotente)
   * - true: borra y vuelve a crear (solo recomendado si la ronda sigue en draft)
   */
  forceReset?: boolean;
};

export function pickRandom<T>(items: T[], count: number): T[] {
  const arr = items.slice();
  // Fisher–Yates shuffle (in-place)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
}

export function pickWeightedRandom(items: { id: string; weight: number }[]): string {
  const filtered = items.filter((i) => Number(i.weight) > 0);
  const total = filtered.reduce((acc, i) => acc + i.weight, 0);
  if (filtered.length === 0 || total <= 0) {
    // Fallback: pick first if something is weird
    return items[0]?.id ?? "";
  }
  let r = Math.random() * total;
  for (const it of filtered) {
    r -= it.weight;
    if (r <= 0) return it.id;
  }
  return filtered[filtered.length - 1].id;
}

export async function startRound(
  params: StartRoundParams
): Promise<
  | { ok: true; alreadyHadAssignments: true; roundId: string; sessionId: string }
  | { ok: true; alreadyHadAssignments: false; roundId: string; sessionId: string }
  | { ok: false; error: string; rlsHint?: string }
> {
  const sessionId = params.sessionId;
  const roundId = params.roundId;
  const impostorCount = Math.floor(Number(params.impostorCount) || 0);

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) return { ok: false, error: "No hay sesión. Vuelve a hacer login." };

  // Validar ronda existe y pertenece a la sesión
  const roundRes = await supabase
    .from("game_rounds")
    .select("id,session_id,status,pack_id,chosen_item_id,starter_session_player_id")
    .eq("id", roundId)
    .single();

  if (roundRes.error || !roundRes.data) {
    return { ok: false, error: roundRes.error?.message ?? "No se pudo cargar la ronda." };
  }
  if (roundRes.data.session_id !== sessionId) {
    return { ok: false, error: "El roundId no pertenece a este sessionId." };
  }

  // Resolver pack_id para esta ronda:
  // - si round.pack_id existe => usarlo
  // - sino, si session.pack_id existe => usarlo
  // - sino, escoger 1 pack aleatorio disponible (global + del usuario) y asignarlo a la ronda
  const resolvedPack = await resolvePackForRound({
    userId,
    sessionId,
    roundId,
    currentRoundPackId: (roundRes.data as { pack_id: string | null }).pack_id ?? null,
  });
  if (!resolvedPack.ok) return { ok: false, error: resolvedPack.error, rlsHint: resolvedPack.rlsHint };
  const packId = resolvedPack.packId;

  // Jugadores activos
  const playersRes = await supabase
    .from("game_session_players")
    .select("id")
    .eq("session_id", sessionId)
    .eq("is_active", true);

  if (playersRes.error) return { ok: false, error: playersRes.error.message, rlsHint: rlsHint(playersRes.error) };

  const playerIds = (playersRes.data ?? []).map((r) => String((r as { id: string }).id));
  if (playerIds.length === 0) return { ok: false, error: "No hay jugadores activos para iniciar la ronda." };

  if (impostorCount <= 0) return { ok: false, error: "impostor_count debe ser >= 1." };
  if (impostorCount >= playerIds.length) {
    return {
      ok: false,
      error: `impostor_count (${impostorCount}) debe ser menor que number_of_players (${playerIds.length}).`,
    };
  }

  // Idempotencia: si ya existen assignments, no volver a crear
  const existsRes = await supabase
    .from("game_round_assignments")
    .select("id")
    .eq("round_id", roundId)
    .limit(1);

  if (existsRes.error) return { ok: false, error: existsRes.error.message, rlsHint: rlsHint(existsRes.error) };

  const hasAssignments = (existsRes.data ?? []).length > 0;
  const nowIso = new Date().toISOString();
  if (hasAssignments && !params.forceReset) {
    // Si la ronda sigue en draft, pasarla a running igualmente (idempotente).
    if (roundRes.data.status === "draft") {
      const upd = await supabase
        .from("game_rounds")
        .update({ status: "running", started_at: nowIso, ended_at: null, pack_id: packId })
        .eq("id", roundId);
      if (upd.error) return { ok: false, error: upd.error.message, rlsHint: rlsHint(upd.error) };
    }

    // Si hay pack y no hay chosen_item_id aún, escoger uno para el secreto
    const alreadyChosen = (roundRes.data as { chosen_item_id: string | null }).chosen_item_id ?? null;
    if (packId && !alreadyChosen) {
      const pick = await pickRandomItemId(packId);
      if (!pick.ok) return { ok: false, error: pick.error, rlsHint: pick.rlsHint };
      const u = await supabase.from("game_rounds").update({ chosen_item_id: pick.itemId }).eq("id", roundId);
      if (u.error) return { ok: false, error: u.error.message, rlsHint: rlsHint(u.error) };
    }

    // Starter (una sola vez por ronda)
    const ensureStarter = await ensureStarterForRound({
      userId,
      sessionId,
      roundId,
      forceReset: false,
    });
    if (!ensureStarter.ok) return { ok: false, error: ensureStarter.error, rlsHint: ensureStarter.rlsHint };

    return { ok: true, alreadyHadAssignments: true, roundId, sessionId };
  }

  if (hasAssignments && params.forceReset) {
    const del = await supabase.from("game_round_assignments").delete().eq("round_id", roundId);
    if (del.error) return { ok: false, error: del.error.message, rlsHint: rlsHint(del.error) };
  }

  const impostors = new Set(pickRandom(playerIds, impostorCount));

  const rows = playerIds.map((pid) => ({
    round_id: roundId,
    owner_id: userId,
    session_player_id: pid,
    role: impostors.has(pid) ? "impostor" : "crew",
    revealed_at: null as string | null,
  }));

  const ins = await supabase.from("game_round_assignments").insert(rows);
  if (ins.error) return { ok: false, error: ins.error.message, rlsHint: rlsHint(ins.error) };

  // Elegir secreto (chosen_item) si hay pack
  let chosenItemId: string | null = null;
  if (packId) {
    const pick = await pickRandomItemId(packId);
    if (!pick.ok) return { ok: false, error: pick.error, rlsHint: pick.rlsHint };
    chosenItemId = pick.itemId;
  }

  // Starter (si forceReset, volvemos a sortear)
  const ensureStarter = await ensureStarterForRound({
    userId,
    sessionId,
    roundId,
    forceReset: Boolean(params.forceReset),
  });
  if (!ensureStarter.ok) return { ok: false, error: ensureStarter.error, rlsHint: ensureStarter.rlsHint };

  const upd = await supabase
    .from("game_rounds")
    .update({
      status: "running",
      started_at: nowIso,
      ended_at: null,
      pack_id: packId,
      chosen_item_id: chosenItemId,
      starter_session_player_id: ensureStarter.starterId,
    })
    .eq("id", roundId);
  if (upd.error) return { ok: false, error: upd.error.message, rlsHint: rlsHint(upd.error) };

  return { ok: true, alreadyHadAssignments: false, roundId, sessionId };
}

async function resolvePackForRound(params: {
  userId: string;
  sessionId: string;
  roundId: string;
  currentRoundPackId: string | null;
}): Promise<{ ok: true; packId: string | null } | { ok: false; error: string; rlsHint?: string }> {
  // Respect explicit pack on round (never override)
  if (params.currentRoundPackId) return { ok: true, packId: params.currentRoundPackId };

  // Try session pack
  const s = await supabase.from("game_sessions").select("pack_id").eq("id", params.sessionId).single();
  if (s.error) return { ok: false, error: s.error.message, rlsHint: rlsHint(s.error) };
  const sessionPackId = (s.data as { pack_id: string | null }).pack_id ?? null;
  if (sessionPackId) return { ok: true, packId: sessionPackId };

  // No pack selected: pick one random available (global OR own)
  const packsRes = await supabase
    .from("packs")
    .select("id,is_global,owner_id,name")
    .or(`is_global.eq.true,owner_id.eq.${params.userId}`)
    .order("is_global", { ascending: false })
    .order("name", { ascending: true });

  if (packsRes.error) return { ok: false, error: packsRes.error.message, rlsHint: rlsHint(packsRes.error) };
  const ids = (packsRes.data ?? []).map((r) => String((r as { id: string }).id));
  if (ids.length === 0) return { ok: false, error: "No hay packs disponibles para iniciar la ronda." };

  const [picked] = pickRandom(ids, 1);
  if (!picked) return { ok: false, error: "No se pudo escoger un pack aleatorio." };

  // Persist on the round so it’s deterministic for this round
  const upd = await supabase.from("game_rounds").update({ pack_id: picked }).eq("id", params.roundId);
  if (upd.error) return { ok: false, error: upd.error.message, rlsHint: rlsHint(upd.error) };

  return { ok: true, packId: picked };
}

async function pickRandomItemId(
  packId: string
): Promise<{ ok: true; itemId: string } | { ok: false; error: string; rlsHint?: string }> {
  const res = await supabase.from("pack_items").select("id").eq("pack_id", packId);
  if (res.error) return { ok: false, error: res.error.message, rlsHint: rlsHint(res.error) };
  const ids = (res.data ?? []).map((r) => String((r as { id: string }).id));
  if (ids.length === 0) return { ok: false, error: "El pack seleccionado no tiene items (pack_items) para elegir." };
  const [id] = pickRandom(ids, 1);
  if (!id) return { ok: false, error: "No se pudo elegir un item del pack." };
  return { ok: true, itemId: id };
}

async function ensureStarterForRound(params: {
  userId: string;
  sessionId: string;
  roundId: string;
  forceReset: boolean;
}): Promise<{ ok: true; starterId: string | null } | { ok: false; error: string; rlsHint?: string }> {
  // Check current starter
  const r = await supabase
    .from("game_rounds")
    .select("starter_session_player_id")
    .eq("id", params.roundId)
    .single();
  if (r.error) return { ok: false, error: r.error.message, rlsHint: rlsHint(r.error) };
  const current = (r.data as { starter_session_player_id: string | null }).starter_session_player_id ?? null;

  if (current && !params.forceReset) return { ok: true, starterId: current };

  if (params.forceReset && current) {
    const clear = await supabase
      .from("game_rounds")
      .update({ starter_session_player_id: null })
      .eq("id", params.roundId);
    if (clear.error) return { ok: false, error: clear.error.message, rlsHint: rlsHint(clear.error) };
  }

  // Active players
  const playersRes = await supabase
    .from("game_session_players")
    .select("id")
    .eq("session_id", params.sessionId)
    .eq("is_active", true);
  if (playersRes.error) return { ok: false, error: playersRes.error.message, rlsHint: rlsHint(playersRes.error) };
  const playerIds = (playersRes.data ?? []).map((x) => String((x as { id: string }).id));
  if (playerIds.length === 0) return { ok: true, starterId: null };

  // Assignments -> roles
  const assignsRes = await supabase
    .from("game_round_assignments")
    .select("session_player_id,role")
    .eq("round_id", params.roundId);
  if (assignsRes.error) return { ok: false, error: assignsRes.error.message, rlsHint: rlsHint(assignsRes.error) };
  const roleByPlayer = new Map<string, string>();
  for (const row of assignsRes.data ?? []) {
    const rr = row as { session_player_id: string; role: string };
    roleByPlayer.set(String(rr.session_player_id), String(rr.role));
  }

  const weighted = playerIds.map((id) => {
    const role = roleByPlayer.get(id);
    const weight = role === "impostor" ? IMPOSTOR_START_WEIGHT : 1.0;
    return { id, weight };
  });

  const picked = pickWeightedRandom(weighted);
  if (!picked) return { ok: true, starterId: null };

  const upd = await supabase
    .from("game_rounds")
    .update({ starter_session_player_id: picked })
    .eq("id", params.roundId);
  if (upd.error) return { ok: false, error: upd.error.message, rlsHint: rlsHint(upd.error) };

  return { ok: true, starterId: picked };
}

function rlsHint(err: PostgrestError): string | undefined {
  const m = String(err.message ?? "").toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied")) {
    return "Parece un error de RLS/permisos. Revisa policies de select en `packs/pack_items` y insert/update en `game_round_assignments` y `game_rounds`.";
  }
  return undefined;
}

