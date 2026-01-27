"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Image from "next/image";
import {
  listGameSessions,
  createGameSession,
  deleteGameSession,
  type GameSession,
} from "@/lib/gameSessions";

export default function GameSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listGameSessions();
    if (res.error) {
      setMsg(res.error.message);
      return;
    }
    setSessions(res.data ?? []);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      void load();
    });
  }, [load, router]);

  async function onCreate() {
    if (!title.trim()) return;
    setLoading(true);
    setMsg(null);

    const res = await createGameSession(title.trim());
    setLoading(false);

    if (res.error) {
      setMsg(res.error.message);
      return;
    }

    setTitle("");
    await load();
  }

  async function onDelete(id: string) {
    if (!confirm("¿Eliminar esta sesión? Se perderán jugadores y rondas.")) return;
    await deleteGameSession(id);
    await load();
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

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image
              src="/impostor-logo.png"
              alt="Impostor Panamá"
              width={220}
              height={120}
              className="h-11 w-auto drop-shadow-xl select-none"
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Sesiones</h1>
            </div>
          </div>

          <button
            onClick={signOut}
            disabled={loading}
            className="rounded-xl btn-ghost px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            Logout
          </button>
        </header>

        {msg && (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {msg}
          </div>
        )}

        <section className="mt-6 glass-card p-5 shadow-2xl">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Nueva sesión</h2>
            <p className="text-sm text-neutral-400">Ej: “Viernes con amigos”</p>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nombre de la sesión"
              className="w-full input-field px-4 py-3 text-base placeholder:text-neutral-500"
            />
            <button
              onClick={onCreate}
              disabled={loading || !title.trim()}
              className="w-full rounded-xl btn-primary px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Creando..." : "Crear"}
            </button>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Mis sesiones</h2>

          {sessions.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-neutral-300">
              Aún no tienes sesiones. Crea una arriba para empezar.
            </div>
          ) : (
            <ul className="mt-3 grid gap-4">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="glass-card p-4 shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{s.title ?? "Impostor Game"}</div>
                      <div className="mt-1 text-xs text-neutral-400">
                        {new Date(s.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <Link
                      href={`/game/${s.id}`}
                      className="rounded-lg btn-primary px-3 py-1.5 text-sm font-semibold"
                    >
                      Entrar
                    </Link>
                    <button
                      onClick={() => onDelete(s.id)}
                      className="rounded-lg btn-ghost px-3 py-1.5 text-sm text-neutral-100"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
