import { NextResponse } from "next/server";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { guardOrigin } from "@/lib/teacher-server";

export async function POST(request: Request) {
  guardOrigin(request);
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
