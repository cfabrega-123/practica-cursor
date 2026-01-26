import { supabase } from "@/lib/supabaseClient";
import type { PostgrestError } from "@supabase/supabase-js";

export type PackRow = {
  id: string;
  name: string;
  kind: string;
  is_global: boolean;
};

export async function listAvailablePacks(): Promise<{ data: PackRow[]; error: PostgrestError | null }> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    // temporal: ayuda a depurar problemas de auth en localhost
    console.log("[listAvailablePacks] auth error", authErr);
  }
  const userId = auth.user?.id ?? null;

  const base = supabase.from("packs").select("id,name,kind,is_global");

  const res = userId
    ? await base
        .or(`is_global.eq.true,owner_id.eq.${userId}`)
        .order("is_global", { ascending: false })
        .order("name", { ascending: true })
    : await base.eq("is_global", true).order("name", { ascending: true });

  // temporal: ayuda a depurar cuando el dropdown queda vacío
  if (res.error) {
    console.log("[listAvailablePacks] query error", res.error);
  }

  return { data: (res.data ?? []) as PackRow[], error: res.error };
}

export async function getPack(packId: string): Promise<{ data: PackRow | null; error: PostgrestError | null }> {
  const res = await supabase
    .from("packs")
    .select("id,name,kind,is_global,owner_id")
    .eq("id", packId)
    .single();

  if (res.error) return { data: null, error: res.error };
  return { data: res.data as PackRow, error: null };
}

