"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { startRound } from "@/lib/startRound";
import { listAvailablePacks, type PackRow } from "@/lib/packs";
import Image from "next/image";
import { deleteRound as deleteRoundById } from "@/lib/gameRound";

type GameSessionRow = {
  id: string;
  title?: string | null;
  created_at: string;
  pack_id: string | null;
  chosen_item_id: string | null;
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
  impostor_count: number;
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
  const sessionId = useMemo(() => getParamId((params as Record<string, unknown>)?.sessionId), [params]);

  const [session, setSession] = useState<GameSessionRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);

  const [newPlayerName, setNewPlayerName] = useState("");
  const [impostorCount, setImpostorCount] = useState(1);

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [savingPack, setSavingPack] = useState(false);

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

    // 1) Session (incluye pack_id)
    let sessionRow: GameSessionRow | null = null;
    const withTitle = await supabase
      .from("game_sessions")
      .select("id,title,created_at,pack_id,chosen_item_id")
      .eq("id", sessionId)
      .single();

    if (withTitle.error) {
      const m = String(withTitle.error.message ?? "").toLowerCase();
      if (m.includes("title") && (m.includes("does not exist") || m.includes("schema cache"))) {
        const fallback = await supabase
          .from("game_sessions")
          .select("id,created_at,pack_id,chosen_item_id")
          .eq("id", sessionId)
          .single();

        if (fallback.error) {
          setMsg(fallback.error.message);
          return;
        }

        const base = fallback.data as {
          id: string;
          created_at: string;
          pack_id: string | null;
          chosen_item_id: string | null;
        };
        sessionRow = {
          id: base.id,
          created_at: base.created_at,
          title: null,
          pack_id: base.pack_id ?? null,
          chosen_item_id: base.chosen_item_id ?? null,
        };
      } else {
        setMsg(withTitle.error.message);
        return;
      }
    } else {
      sessionRow = withTitle.data as GameSessionRow;
    }

    if (sessionRow) {
      setSession(sessionRow);
      setSelectedPackId(sessionRow.pack_id ?? "");
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
      .select("id,round_number,status,impostor_count,created_at")
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
      void (async () => {
        const res = await listAvailablePacks();
        if (res.error) {
          setMsg(res.error.message);
          return;
        }
        setPacks(res.data);
      })();
    });
  }, [loadAll, router, sessionId]);

  const selectedPack = useMemo(() => {
    const id = selectedPackId || session?.pack_id || "";
    return packs.find((p) => p.id === id) ?? null;
  }, [packs, selectedPackId, session?.pack_id]);

  async function saveSessionPack(packId: string) {
    if (!sessionId) return;
    setSavingPack(true);
    setMsg(null);

    const res = await supabase
      .from("game_sessions")
      .update({ pack_id: packId || null, chosen_item_id: null })
      .eq("id", sessionId);

    setSavingPack(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    // Si hay rondas draft, limpia el secreto para que se regenere al iniciar
    await supabase
      .from("game_rounds")
      .update({ chosen_item_id: null, pack_id: packId || null })
      .eq("session_id", sessionId)
      .eq("status", "draft");

    setSelectedPackId(packId);
    await loadAll();
  }

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
    if (loading) return;
    setLoading(true);
    setMsg(null);
    const res = await supabase
      .from("game_session_players")
      .delete()
      .eq("id", id)
      .eq("session_id", sessionId);
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

    const activeCount = players.filter((p) => p.is_active).length;
    const imp = Math.max(1, Math.min(10, Number(impostorCount) || 1));
    if (activeCount === 0) {
      setMsg("No hay jugadores activos. Agrega jugadores antes de crear una ronda.");
      return;
    }
    if (imp >= activeCount) {
      setMsg(`No se puede crear la ronda: impostores (${imp}) debe ser menor que jugadores activos (${activeCount}).`);
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

    const res = await supabase
      .from("game_rounds")
      .insert({
        session_id: sessionId,
        owner_id: userId,
        round_number: nextNum,
        status: "draft",
        impostor_count: imp,
        pack_id: selectedPackId || session?.pack_id || null,
        chosen_item_id: null,
        started_at: null,
        ended_at: null,
      })
      .select("id")
      .single();

    setLoading(false);
    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    const roundId = String((res.data as { id: string }).id);

    // Start round (creates assignments + sets running) and go to reveal UI
    setLoading(true);
    const started = await startRound({ sessionId, roundId, impostorCount: imp });
    setLoading(false);

    if (!started.ok) {
      setMsg(started.rlsHint ? `${started.error}\n\n${started.rlsHint}` : started.error);
      await loadAll();
      return;
    }

    router.push(`/game/${sessionId}/round/${roundId}`);
  }

  async function onStartExistingRound(r: RoundRow) {
    if (!sessionId) return;
    setMsg(null);

    // Idempotente: si ya tiene assignments, startRound no los recrea.
    setLoading(true);
    const started = await startRound({ sessionId, roundId: r.id, impostorCount: r.impostor_count });
    setLoading(false);

    if (!started.ok) {
      setMsg(started.rlsHint ? `${started.error}\n\n${started.rlsHint}` : started.error);
      return;
    }

    router.push(`/game/${sessionId}/round/${r.id}`);
  }

  async function deletePastRound(roundId: string) {
    if (!sessionId) return;
    if (loading) return;
    setLoading(true);
    setMsg(null);
    const res = await deleteRoundById(roundId);
    setLoading(false);

    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    await loadAll();
  }

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/game" className="text-sm text-neutral-300 hover:text-white">
              ← Volver a sesiones
            </Link>
            <div className="mt-3 flex items-center gap-3">
              <Image
                src="/impostor-logo.png"
                alt="Impostor Panamá"
                width={220}
                height={120}
                className="h-10 w-auto drop-shadow-xl select-none"
              />
              <h1 className="text-2xl font-semibold tracking-tight">{session?.title ?? "Impostor Game"}</h1>
            </div>
            {session?.created_at && (
              <p className="mt-1 text-sm text-neutral-400">
                Creada: {new Date(session.created_at).toLocaleString()}
              </p>
            )}
          </div>

          <button
            onClick={signOut}
            disabled={loading}
            className="rounded-xl btn-ghost px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            Logout
          </button>
        </header>

        <section className="mt-6 glass-card p-5 shadow-2xl">
          <h2 className="text-lg font-semibold">Pack</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Selecciona el pack para esta sesión. Esto reinicia el secreto (chosen item).
          </p>

          <div className="mt-4 flex flex-col gap-3">
            <select
              value={selectedPackId || session?.pack_id || ""}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedPackId(v);
                void saveSessionPack(v);
              }}
              disabled={savingPack}
              className="w-full input-field px-4 py-3 text-base disabled:opacity-60"
            >
              <option value="">— Sin pack —</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.is_global ? "[Global] " : "[Privado] "}
                  {p.name} ({p.kind})
                </option>
              ))}
            </select>

            <div className="text-sm text-neutral-300">
              Actual: <span className="font-semibold">{selectedPack?.name ?? "—"}</span>
            </div>
          </div>
        </section>

        {msg && (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div>{msg}</div>
            {schemaHint && <div className="mt-2 text-red-100/80">{schemaHint}</div>}
          </div>
        )}

        <div className="mt-6 grid gap-6">
          <section className="glass-card p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Jugadores</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Agrega el roster de tu sesión. Puedes desactivar jugadores sin borrarlos.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <input
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Nombre del jugador"
                className="w-full input-field px-4 py-3 text-base placeholder:text-neutral-500"
              />
              <button
                onClick={addPlayer}
                disabled={loading || !newPlayerName.trim()}
                className="w-full rounded-xl btn-primary px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
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
                      <div className="text-xs text-neutral-500">{p.is_active ? "Activo" : "Inactivo"}</div>
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

          <section className="glass-card p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Rondas</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Por ahora puedes crear rondas en estado <span className="font-semibold">draft</span>.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <label className="text-sm text-neutral-300">Impostores</label>
              <input
                value={String(impostorCount)}
                onChange={(e) => setImpostorCount(Number(e.target.value))}
                type="number"
                min={1}
                max={10}
                className="w-full input-field px-4 py-3 text-base"
              />
              <button
                onClick={createRound}
                disabled={loading}
                className="w-full rounded-xl btn-primary px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">Ronda #{r.round_number}</div>
                        <div className="text-xs text-neutral-500">Estado: {r.status}</div>
                      </div>
                      <div className="text-xs text-neutral-500">{new Date(r.created_at).toLocaleString()}</div>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {r.status === "draft" ? (
                        <button
                          onClick={() => onStartExistingRound(r)}
                          disabled={loading}
                          className="w-full rounded-xl btn-primary px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Comenzar ronda
                        </button>
                      ) : (
                        <Link
                          href={sessionId ? `/game/${sessionId}/round/${r.id}` : "#"}
                          className="w-full rounded-xl btn-primary px-4 py-2 text-sm font-semibold text-center"
                          aria-disabled={!sessionId}
                        >
                          Entrar a reveal
                        </Link>
                      )}

                      {r.status !== "running" && (
                        <button
                          onClick={() => deletePastRound(r.id)}
                          disabled={loading}
                          className="w-full rounded-xl btn-ghost px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Borrar ronda
                        </button>
                      )}
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

