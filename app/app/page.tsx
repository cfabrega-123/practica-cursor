"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/projects");
      else router.replace("/login");
    });
  }, [router]);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      Redirigiendo...
    </main>
  );
}
