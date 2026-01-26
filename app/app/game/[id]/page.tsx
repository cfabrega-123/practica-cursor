"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type GameSessionRow = {
  id: string;
  title?: string | null;
  created_at: string;
};

type PlayerRow = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type RoundRow = {
  id: string;
  round_number: number;
  status: string;
  created_at: string;
};

function looksLikeMissingRelation(errMsg: string, relationName: string) {
  const m = errMsg.toLowerCase();
  return m.includes(relationName.toLowerCase()) && m.includes("does not exist");
}

function getParamId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0];
  return null;
}

export default function GameSessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = useMemo(() => getParamId((params as Record<string, unknown>)?.id), [params]);

  const [session, setSession] = useState<GameSessionRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);

  const [newPlayerName, setNewPlayerName] = useState("");
  const [impostorCount, setImpostorCount] = useState(1);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const schemaHint = useMemo(() => {
    if (!msg) return null;
    const lower = msg.toLowerCase();
    if (looksLikeMissingRelation(lower, "game_session_players") || looksLikeMissingRelation(lower, "game_rounds")) {
      return "Te falta correr `db/sql/005_impostor_game_sessions_rounds.sql` en Supabase.";
    }
    return null;
  }, [msg]);

  const loadAll = useCallback(async () => {
    setMsg(null);

    if (!sessionId) {
      setMsg("URL inválida: falta el id de la sesión.");
      return;
    }

    // 1) Session (tolerante a DB sin title)
    const withTitle = await supabase
      .from("game_sessions")
      .select("id,title,created_at")
      .eq("id", sessionId)
      .single();

    if (withTitle.error) {
      const m = String(withTitle.error.message ?? "").toLowerCase();
      if (m.includes("title") && (m.includes("does not exist") || m.includes("schema cache"))) {
        const fallback = await supabase
          .from("game_sessions")
          .select("id,created_at")
          .eq("id", sessionId)
          .single();

        if (fallback.error) {
          setMsg(fallback.error.message);
          return;
        }

        const base = fallback.data as { id: string; created_at: string };
        setSession({ id: base.id, created_at: base.created_at, title: null });
      } else {
        setMsg(withTitle.error.message);
        return;
      }
    } else {
      setSession(withTitle.data as GameSessionRow);
    }

    // 2) Players (roster)
    const p = await supabase
      .from("game_session_players")
      .select("id,name,is_active,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (p.error) {
      setMsg(p.error.message);
      return;
    }
    setPlayers((p.data ?? []) as PlayerRow[]);

    // 3) Rounds
    const r = await supabase
      .from("game_rounds")
      .select("id,round_number,status,created_at")
      .eq("session_id", sessionId)
      .order("round_number", { ascending: false });

    if (r.error) {
      setMsg(r.error.message);
      return;
    }
    setRounds((r.data ?? []) as RoundRow[]);
  }, [sessionId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      if (!sessionId) {
        setMsg("URL inválida: falta el id de la sesión.");
        return;
      }
      void loadAll();
    });
  }, [loadAll, router, sessionId]);

  async function signOut() {
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    router.replace("/login");
  }

  async function addPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;
    if (!sessionId) {
      setMsg("URL inválida: falta el id de la sesión.");
      return;
    }
    setLoading(true);
    setMsg(null);

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id;
    if (!userId) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const res = await supabase.from("game_session_players").insert({
      session_id: sessionId,
      owner_id: userId,
      name,
      is_active: true,
    });

    setLoading(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    setNewPlayerName("");
    await loadAll();
  }

  async function togglePlayer(id: string, isActive: boolean) {
    if (!sessionId) {
      setMsg("URL inválida: falta el id de la sesión.");
      return;
    }
    setLoading(true);
    setMsg(null);
    const res = await supabase
      .from("game_session_players")
      .update({ is_active: !isActive })
      .eq("id", id)
      .eq("session_id", sessionId);
    setLoading(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }
    await loadAll();
  }

  async function deletePlayer(id: string) {
    if (!sessionId) {
      setMsg("URL inválida: falta el id de la sesión.");
      return;
    }
    const ok = confirm("¿Eliminar jugador?");
    if (!ok) return;
    setLoading(true);
    setMsg(null);
    const res = await supabase.from("game_session_players").delete().eq("id", id).eq("session_id", sessionId);
    setLoading(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }
    await loadAll();
  }

  async function createRound() {
    if (!sessionId) {
      setMsg("URL inválida: falta el id de la sesión.");
      return;
    }
    setLoading(true);
    setMsg(null);

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id;
    if (!userId) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const maxRound = rounds.reduce((acc, r) => Math.max(acc, r.round_number), 0);
    const nextNum = maxRound + 1;

    const res = await supabase.from("game_rounds").insert({
      session_id: sessionId,
      owner_id: userId,
      round_number: nextNum,
      status: "draft",
      impostor_count: Math.max(1, Math.min(10, Number(impostorCount) || 1)),
      pack_id: null,
      chosen_item_id: null,
      started_at: null,
      ended_at: null,
    });

    setLoading(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    await loadAll();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 text-neutral-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/game" className="text-sm text-neutral-300 hover:text-white">
              ← Volver a sesiones
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {session?.title ?? "Impostor Game"}
            </h1>
            {session?.created_at && (
              <p className="mt-1 text-sm text-neutral-400">
                Creada: {new Date(session.created_at).toLocaleString()}
              </p>
            )}
          </div>

          <button
            onClick={signOut}
            disabled={loading}
            className="rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-neutral-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Logout
          </button>
        </header>

        {msg && (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div>{msg}</div>
            {schemaHint && <div className="mt-2 text-red-100/80">{schemaHint}</div>}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
            <h2 className="text-lg font-semibold">Jugadores</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Agrega el roster de tu sesión. Puedes desactivar jugadores sin borrarlos.
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Nombre del jugador"
                className="w-full flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-white/20"
              />
              <button
                onClick={addPlayer}
                disabled={loading || !newPlayerName.trim()}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Agregar
              </button>
            </div>

            {players.length === 0 ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300">
                Sin jugadores todavía.
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className={["font-medium", p.is_active ? "" : "text-neutral-400 line-through"].join(" ")}>
                        {p.name}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {p.is_active ? "Activo" : "Inactivo"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => togglePlayer(p.id, p.is_active)}
                        disabled={loading}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60"
                      >
                        {p.is_active ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        onClick={() => deletePlayer(p.id)}
                        disabled={loading}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60"
                      >
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
            <h2 className="text-lg font-semibold">Rondas</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Por ahora puedes crear rondas en estado <span className="font-semibold">draft</span>.
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-sm text-neutral-300">Impostores</label>
              <input
                value={String(impostorCount)}
                onChange={(e) => setImpostorCount(Number(e.target.value))}
                type="number"
                min={1}
                max={10}
                className="w-full max-w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              />
              <button
                onClick={createRound}
                disabled={loading}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Crear ronda
              </button>
            </div>

            {rounds.length === 0 ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300">
                Sin rondas todavía.
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {rounds.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">Ronda #{r.round_number}</div>
                      <div className="text-xs text-neutral-500">Estado: {r.status}</div>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

