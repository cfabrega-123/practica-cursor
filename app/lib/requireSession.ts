import { supabase } from "./supabaseClient";

export async function requireSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
