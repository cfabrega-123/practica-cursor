"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Image from "next/image";
import {
  deleteRound,
  endRound,
  getAssignments,
  getChosenItemLabel,
  getPackName,
  getRound,
  listActivePlayers,
  markRevealed,
  type ActivePlayer,
  type GameRound,
  type RoundAssignment,
} from "@/lib/gameRound";
import { startRound } from "@/lib/startRound";

function getParamId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0];
  return null;
}

type ModalState =
  | { open: false }
  | { open: true; playerId: string; step: "confirm" | "reveal" };

export default function RoundRevealPage() {
  const router = useRouter();
  const params = useParams();

  const sessionIdParam = useMemo(
    () => getParamId((params as Record<string, unknown>)?.sessionId),
    [params]
  );
  const roundId = useMemo(() => getParamId((params as Record<string, unknown>)?.roundId), [params]);

  const [round, setRound] = useState<GameRound | null>(null);
  const [packName, setPackName] = useState<string | null>(null);
  const [secretLabel, setSecretLabel] = useState<string | null>(null);
  const [players, setPlayers] = useState<ActivePlayer[]>([]);
  const [assignments, setAssignments] = useState<RoundAssignment[]>([]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ open: false });
  const [showImpostors, setShowImpostors] = useState(false);

  const assignmentByPlayerId = useMemo(() => {
    const m = new Map<string, RoundAssignment>();
    for (const a of assignments) m.set(a.session_player_id, a);
    return m;
  }, [assignments]);

  const revealStats = useMemo(() => {
    const total = players.length;
    const revealed = players.reduce((acc, p) => {
      const a = assignmentByPlayerId.get(p.id);
      return acc + (a?.revealed_at ? 1 : 0);
    }, 0);
    return { revealed, total };
  }, [assignmentByPlayerId, players]);

  const load = useCallback(async () => {
    setMsg(null);

    if (!roundId) {
      setMsg("URL inválida: falta roundId.");
      return;
    }

    setLoading(true);

    // Require auth session (client-only)
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const roundRes = await getRound(roundId);
    if (roundRes.error || !roundRes.data) {
      setLoading(false);
      setMsg(roundRes.error?.message ?? "No se pudo cargar la ronda.");
      return;
    }

    // If sessionId param doesn't match the round, redirect to correct URL
    if (sessionIdParam && roundRes.data.session_id !== sessionIdParam) {
      setLoading(false);
      router.replace(`/game/${roundRes.data.session_id}/round/${roundId}`);
      return;
    }

    setRound(roundRes.data);

    const [packRes, secretRes, playersRes, assignRes] = await Promise.all([
      getPackName(roundRes.data.pack_id),
      getChosenItemLabel(roundRes.data.chosen_item_id),
      listActivePlayers(roundRes.data.session_id),
      getAssignments(roundId),
    ]);

    if (packRes.error) setMsg(packRes.error.message);
    if (secretRes.error) setMsg(secretRes.error.message);
    if (playersRes.error) setMsg(playersRes.error.message);
    if (assignRes.error) setMsg(assignRes.error.message);

    setPackName(packRes.data);
    setSecretLabel(secretRes.data);
    setPlayers(playersRes.data);
    setAssignments(assignRes.data);

    setLoading(false);
  }, [roundId, router, sessionIdParam]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const headerPack = packName ?? "—";
  const status = round?.status ?? "—";
  const roundNumber = round?.round_number ?? 0;

  const lobbyHref = useMemo(() => {
    // If sessionIdParam missing, fallback to round.session_id when available.
    const sid = sessionIdParam ?? round?.session_id ?? "";
    return sid ? `/game/${sid}` : "/game";
  }, [round?.session_id, sessionIdParam]);

  function openPlayer(playerId: string) {
    setModal({ open: true, playerId, step: "confirm" });
  }

  function closeModal() {
    setModal({ open: false });
  }

  const modalPlayer = useMemo(() => {
    if (!modal.open) return null;
    return players.find((p) => p.id === modal.playerId) ?? null;
  }, [modal, players]);

  const modalAssignment = useMemo(() => {
    if (!modal.open) return null;
    return assignmentByPlayerId.get(modal.playerId) ?? null;
  }, [assignmentByPlayerId, modal]);

  const impostorNames = useMemo(() => {
    const impostorIds = new Set(
      assignments.filter((a) => a.role === "impostor").map((a) => a.session_player_id)
    );
    return players.filter((p) => impostorIds.has(p.id)).map((p) => p.name);
  }, [assignments, players]);

  async function revealNow() {
    if (!modal.open) return;
    if (!modalAssignment) {
      setMsg("No hay rol asignado para este jugador en esta ronda.");
      setModal({ ...modal, step: "reveal" });
      return;
    }

    // Mark revealed only first time
    if (!modalAssignment.revealed_at) {
      const res = await markRevealed(modalAssignment.id);
      if (res.error) {
        setMsg(res.error.message);
      } else {
        // reload data (requested)
        await load();
      }
    }

    setModal({ ...modal, step: "reveal" });
  }

  async function onEndRound() {
    if (!roundId || !round) return;
    if (round.status !== "running") return;
    const ok = confirm("¿Terminar ronda? Ya no se podrá revelar más.");
    if (!ok) return;

    setLoading(true);
    const res = await endRound(roundId);
    setLoading(false);

    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    await load();
  }

  async function onPlayAgain() {
    if (!roundId || !round) return;
    if (round.status !== "ended") return;
    const ok = confirm("¿Jugar de nuevo en esta misma ronda? Se volverán a mezclar los roles.");
    if (!ok) return;

    setLoading(true);
    const started = await startRound({
      sessionId: round.session_id,
      roundId,
      impostorCount: round.impostor_count,
      forceReset: true,
    });
    setLoading(false);

    if (!started.ok) {
      setMsg(started.rlsHint ? `${started.error}\n\n${started.rlsHint}` : started.error);
      return;
    }

    await load();
  }

  async function onDeleteRound() {
    if (!roundId || !round) return;
    if (round.status !== "ended") return;
    const ok = confirm("¿Borrar esta ronda? (Se eliminarán también sus asignaciones)");
    if (!ok) return;

    setLoading(true);
    const res = await deleteRound(roundId);
    setLoading(false);

    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    router.replace(lobbyHref);
  }

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <header className="space-y-4">
          <Link
            href={lobbyHref}
            className="w-full inline-flex items-center justify-center rounded-xl btn-ghost px-4 py-3 text-sm font-semibold text-neutral-100"
          >
            ← Volver al lobby
          </Link>

          <div className="flex flex-col items-center text-center gap-2">
            <Image
              src="/impostor-logo.png"
              alt="Impostor Panamá"
              width={260}
              height={140}
              className="h-12 w-auto drop-shadow-xl select-none"
            />
            <h1 className="text-2xl font-semibold tracking-tight">Ronda #{roundNumber}</h1>
          </div>

          <div className="flex flex-wrap justify-center gap-2 text-xs text-neutral-200/90">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              Estado: <span className="font-semibold">{status}</span>
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              Pack: <span className="font-semibold">{headerPack}</span>
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              Reveal:{" "}
              <span className="font-semibold">
                {revealStats.revealed} / {revealStats.total}
              </span>
            </span>
          </div>

          <div className="grid gap-2">
            <button
              onClick={onEndRound}
              disabled={loading || round?.status !== "running"}
              className="w-full rounded-xl btn-primary px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              title={round?.status !== "running" ? "Solo disponible cuando la ronda está en running" : undefined}
            >
              Terminar ronda
            </button>

            <button
              onClick={onPlayAgain}
              disabled={loading || round?.status !== "ended"}
              className="w-full rounded-xl btn-ghost px-4 py-3 text-base font-semibold text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              title={round?.status !== "ended" ? "Disponible cuando la ronda está ended" : undefined}
            >
              Jugar de nuevo
            </button>

            <button
              onClick={() => setShowImpostors(true)}
              disabled={loading || round?.status !== "ended"}
              className="w-full rounded-xl btn-ghost px-4 py-3 text-base font-semibold text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              title={round?.status !== "ended" ? "Disponible cuando la ronda está ended" : undefined}
            >
              Revelar impostores
            </button>

            <button
              onClick={onDeleteRound}
              disabled={loading || round?.status !== "ended"}
              className="w-full rounded-xl btn-ghost px-4 py-3 text-base font-semibold text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              title={round?.status !== "ended" ? "Disponible cuando la ronda está ended" : undefined}
            >
              Borrar ronda
            </button>
          </div>
        </header>

        {msg && (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {msg}
          </div>
        )}

        <section className="mt-6 glass-card p-5 shadow-2xl">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Jugadores activos</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Pasa el teléfono. Cada jugador toca su nombre y revela su rol.
              </p>
            </div>
            {loading && <div className="text-xs text-neutral-400">Cargando…</div>}
          </div>

          {players.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300">
              No hay jugadores activos en esta sesión.
            </div>
          ) : (
            <ul className="mt-4 grid gap-3">
              {players.map((p) => {
                const a = assignmentByPlayerId.get(p.id);
                const revealed = Boolean(a?.revealed_at);
                const disabled = !a;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => openPlayer(p.id)}
                      disabled={disabled}
                      className={[
                        "w-full rounded-xl border px-4 py-4 text-left transition",
                        disabled
                          ? "cursor-not-allowed border-white/5 bg-black/10 text-neutral-500"
                          : "border-white/10 bg-black/20 hover:bg-black/30 active:translate-y-[1px]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">{p.name}</div>
                        <div
                          className={[
                            "text-xs rounded-full px-2 py-1 border",
                            revealed
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                              : "border-white/10 bg-white/5 text-neutral-200/80",
                          ].join(" ")}
                        >
                          {disabled ? "Sin rol" : revealed ? "Revelado" : "Pendiente"}
                        </div>
                      </div>
                      {!a && (
                        <div className="mt-1 text-xs text-neutral-500">
                          No hay asignación para este jugador en esta ronda.
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Modal */}
        {modal.open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-neutral-400">Jugador</div>
                  <div className="truncate text-lg font-semibold">{modalPlayer?.name ?? "—"}</div>
                </div>
                <button
                  onClick={closeModal}
                  className="rounded-lg px-2 py-1 text-sm text-neutral-200 hover:bg-white/10"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              {modal.step === "confirm" && (
                <div className="mt-5">
                  <p className="text-sm text-neutral-200">
                    Asegúrate que <span className="font-semibold">solo el jugador</span> esté mirando.
                  </p>
                  <button
                    onClick={revealNow}
                    disabled={!modalAssignment}
                    className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Revelar mi rol
                  </button>
                </div>
              )}

              {modal.step === "reveal" && (
                <div className="mt-5">
                  {!modalAssignment ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                      No hay rol asignado para este jugador en esta ronda.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs text-neutral-400">Tu rol</div>

                      {modalAssignment.role === "impostor" ? (
                        <>
                          <div className="mt-2 text-3xl font-black tracking-tight text-red-300">
                            IMPOSTOR
                          </div>
                          <div className="mt-2 text-sm text-neutral-200">
                            Pack: <span className="font-semibold">{headerPack}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 text-3xl font-black tracking-tight text-emerald-200">
                            CREW
                          </div>
                          <div className="mt-2 text-sm text-neutral-200">
                            Pack: <span className="font-semibold">{headerPack}</span>
                          </div>
                          <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-neutral-100">
                            Secreto:{" "}
                            <span className="font-semibold">
                              {secretLabel ?? "—"}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    onClick={closeModal}
                    className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-white/10"
                  >
                    Ocultar / Siguiente jugador
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Impostors modal */}
        {showImpostors && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-400">Resultado</div>
                  <div className="text-lg font-semibold">Impostores</div>
                </div>
                <button
                  onClick={() => setShowImpostors(false)}
                  className="rounded-lg px-2 py-1 text-sm text-neutral-200 hover:bg-white/10"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                {impostorNames.length === 0 ? (
                  <p className="text-sm text-neutral-300">
                    No se encontró ningún impostor (¿no hay asignaciones cargadas?).
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {impostorNames.map((n) => (
                      <li
                        key={n}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <span className="font-semibold text-red-200">{n}</span>
                        <span className="text-xs text-neutral-400">IMPOSTOR</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                onClick={() => setShowImpostors(false)}
                className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

