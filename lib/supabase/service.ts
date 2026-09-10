import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-side use only.
 *
 * The workspace RPCs (get_workspace_json, sync_workspace) are revoked from the
 * anon and authenticated roles, so they can only be reached with the service
 * role key. Never import this from client components, and only call it after
 * the request's owner has been verified with the user-scoped client.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase service role is not configured for this deployment.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
