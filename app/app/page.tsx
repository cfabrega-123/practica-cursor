"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Landing page: siempre empieza en Login.
    // Si ya hay sesión, el propio /login te redirige a /game.
    router.replace("/login");
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center">
      <p className="text-sm text-neutral-500">Redirigiendo...</p>
    </main>
  );
}
