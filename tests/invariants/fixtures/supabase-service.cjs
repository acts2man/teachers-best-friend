// Stand-in for lib/supabase/service: the service-role client is whatever fake
// the test installed on globalThis.__fakeSupabase.
module.exports = { createServiceClient: () => globalThis.__fakeSupabase };
