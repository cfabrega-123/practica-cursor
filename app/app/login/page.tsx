"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [existingSessionEmail, setExistingSessionEmail] = useState<string | null>(null);

  // UI mode
  const [mode, setMode] = useState<"login" | "signup">("login");

  // LOGIN: email o username
  const [identifier, setIdentifier] = useState("");

  // SIGNUP: username
  const [username, setUsername] = useState("");

  // shared
  const [password, setPassword] = useState("");

  // ui state
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setExistingSessionEmail(data.session?.user.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        // Si acaba de iniciar sesión, sí redirigimos al juego.
        router.replace("/game");
      } else {
        // Si cerró sesión, mostramos el formulario normal.
        setExistingSessionEmail(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function signOut() {
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
      setExistingSessionEmail(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error cerrando sesión.";
      setMsg(message);
    } finally {
      setLoading(false);
    }
  }

  async function resolveEmailFromIdentifier(raw: string) {
    const trimmed = raw.trim();
    const looksLikeEmail = trimmed.includes("@");

    if (looksLikeEmail) return trimmed.toLowerCase();

    // Si es username: resolvemos el email vía RPC (evita problemas de RLS)
    const { data, error } = await supabase.rpc("resolve_login_email", {
      p_identifier: trimmed,
    });

    if (error) {
      const msg = typeof error.message === "string" ? error.message : "";
      // PostgREST "function not found" suele aparecer así:
      // "Could not find the function public.resolve_login_email(...) in the schema cache"
      if (msg.toLowerCase().includes("resolve_login_email") && msg.toLowerCase().includes("schema cache")) {
        throw new Error(
          "Falta crear el RPC `resolve_login_email` en la DB. Aplica `db/sql/004_auth_profiles_username_login.sql`."
        );
      }
    }

    if (error || !data) {
      // Mensaje genérico para no filtrar si existe o no el username
      throw new Error("Credenciales inválidas.");
    }

    return String(data).toLowerCase();
  }

  async function maybeFinalizeUsernameAfterLogin() {
    // Si hay un username pendiente de cuando hizo signup, lo guardamos ahora que ya hay sesión
    const pending = localStorage.getItem("pending_username");
    if (!pending) return;

    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;

    const u = pending.trim();
    if (!u) {
      localStorage.removeItem("pending_username");
      return;
    }

    // Update del profile del usuario logueado (RLS: auth.uid() = id)
    const { error } = await supabase.from("profiles").update({ username: u }).eq("id", uid);

    if (!error) {
      localStorage.removeItem("pending_username");
    }
    // Si hubiera error, lo dejamos pendiente y lo intentará en el próximo login
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const raw = identifier.trim();
      if (!raw) throw new Error("Escribe tu email o username.");
      if (!password) throw new Error("Escribe tu password.");

      const emailToUse = await resolveEmailFromIdentifier(raw);

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });

      if (error) throw new Error(error.message);

      // Guardar username pendiente (si existe) ahora que ya hay sesión
      await maybeFinalizeUsernameAfterLogin();

      // redirect lo hace onAuthStateChange
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al iniciar sesión.";
      setMsg(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    try {
      const email = identifier.trim().toLowerCase();
      const u = username.trim();

      if (!email.includes("@")) throw new Error("En Signup debes usar un email válido.");
      if (!password) throw new Error("Escribe un password.");
      if (u.length < 3 || u.length > 20) throw new Error("Username debe tener 3–20 caracteres.");
      if (!/^[a-zA-Z0-9_]+$/.test(u)) throw new Error("Username solo puede tener letras, números y _.");

      setLoading(true);

      // Guardamos username temporalmente para finalizarlo después del primer login (cuando haya sesión)
      localStorage.setItem("pending_username", u);

      // 1) Crear usuario en Supabase Auth
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: u },
        },
      });

      if (error) throw new Error(error.message);

      // NO hacemos upsert/insert a profiles aquí, para evitar error RLS.
      // El profile lo crea el trigger (handle_new_user) en el servidor.
      setMsg(
        "Cuenta creada. Si tu proyecto requiere confirmación por email, confirma y luego haz login. " +
          "Al hacer login, se terminará de guardar tu username."
      );
      setMode("login");
      setPassword("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error creando cuenta.";
      setMsg(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/impostor-logo.png"
            alt="Impostor Panamá"
            width={420}
            height={240}
            priority
            className="h-28 w-auto drop-shadow-2xl floaty select-none"
          />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Impostor Panamá
          </h1>
          <p className="mt-1 text-sm text-neutral-300">
            Pasa el teléfono, revela tu rol y juega con tu gente.
          </p>
        </div>

        <div className="mt-6 glass-card p-6 shadow-2xl">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-tight">
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </h2>
            <p className="mt-1 text-sm text-neutral-300">
              Usa email o username.
            </p>
          </div>

          {existingSessionEmail && (
            <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-neutral-200">
                Ya hay una sesión activa como{" "}
                <span className="font-semibold">{existingSessionEmail}</span>.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => router.replace("/game")}
                  className="flex-1 rounded-xl btn-primary px-3 py-2 text-sm font-semibold transition"
                >
                  Continuar
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={loading}
                  className="flex-1 rounded-xl btn-ghost px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1">
            <button
              onClick={() => {
                setMsg(null);
                setMode("login");
              }}
              className={[
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                mode === "login" ? "bg-white/15" : "hover:bg-white/10",
              ].join(" ")}
              type="button"
            >
              Login
            </button>

            <button
              onClick={() => {
                setMsg(null);
                setMode("signup");
              }}
              className={[
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                mode === "signup" ? "bg-white/15" : "hover:bg-white/10",
              ].join(" ")}
              type="button"
            >
              Signup
            </button>
          </div>

          <form
            onSubmit={mode === "login" ? handleLogin : handleSignUp}
            className="mt-5 space-y-4"
          >
            <div>
              <label className="text-sm text-neutral-300">
                {mode === "login" ? "Email o Username" : "Email"}
              </label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  mode === "login" ? "tuemail@dominio.com o calix_123" : "tuemail@dominio.com"
                }
                className="mt-1 w-full input-field px-3 py-2 text-sm placeholder:text-neutral-500"
                autoComplete={mode === "login" ? "username" : "email"}
              />
            </div>

            <div>
              <label className="text-sm text-neutral-300">Password</label>
              <div className="relative mt-1">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full input-field px-3 py-2 pr-10 text-sm placeholder:text-neutral-500"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm text-neutral-200 hover:bg-white/10 active:translate-y-[calc(-50%+1px)]"
                  aria-label={showPassword ? "Ocultar password" : "Mostrar password"}
                  title={showPassword ? "Ocultar password" : "Mostrar password"}
                >
                  👁️
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div>
                <label className="text-sm text-neutral-300">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ej: calix_123"
                  className="mt-1 w-full input-field px-3 py-2 text-sm placeholder:text-neutral-500"
                  autoComplete="username"
                />
                <p className="mt-2 text-xs text-neutral-400">
                  Username: 3–20 caracteres, solo letras/números/guion bajo.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifier.trim() || !password || (mode === "signup" && !username.trim())}
              className="w-full rounded-xl btn-primary px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Procesando..." : mode === "login" ? "Entrar" : "Crear cuenta"}
            </button>

            {msg && (
              <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {msg}
              </p>
            )}
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Hecho para jugar rápido.
        </p>
      </div>
    </main>
  );
}
