export interface SupabaseEnv {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
}

export function getPublicSupabaseConfig(_env: SupabaseEnv) {
  return null;
}
