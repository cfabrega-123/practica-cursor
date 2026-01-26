"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/projects");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) router.replace("/projects");
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function sendMagicLink() {
    setLoading(true);
    setSent(false);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    setLoading(false);

    if (error) return alert(error.message);
    setSent(true);
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Login</h1>
      <p>Entra con Magic Link para probar Supabase + RLS.</p>

      <label style={{ display: "block", marginTop: 16 }}>Email</label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tuemail@dominio.com"
        style={{ width: "100%", padding: 10, fontSize: 14 }}
      />

      <button
        onClick={sendMagicLink}
        disabled={loading || !email}
        style={{ marginTop: 12, padding: 10, fontSize: 14 }}
      >
        {loading ? "Enviando..." : "Enviar Magic Link"}
      </button>

      {sent && (
        <p style={{ marginTop: 12 }}>
          Revisa tu correo y abre el link para iniciar sesión.
        </p>
      )}
    </main>
  );
}
