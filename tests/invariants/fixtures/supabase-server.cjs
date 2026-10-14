// Stand-in for lib/supabase/server: the Supabase deployment is "configured".
module.exports = { hasSupabaseConfig: () => true, createClient: async () => globalThis.__fakeSupabase };
