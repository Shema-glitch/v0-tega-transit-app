/**
 * Server-side Supabase client for Next.js Route Handlers.
 *
 * This module MUST only be imported in server-side code (route.ts files,
 * server components, server actions). It is NOT safe to import in client
 * components because env vars without NEXT_PUBLIC_ are unavailable there.
 *
 * Credential resolution order (first defined wins):
 *   URL  → SUPABASE_URL → NEXT_PUBLIC_SUPABASE_URL
 *   KEY  → SUPABASE_ANON_KEY → SUPABASE_PUBLISHABLE_KEY → NEXT_PUBLIC_SUPABASE_ANON_KEY
 *           → NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *
 * getSupabaseAdmin() below is a SEPARATE client using the service_role key —
 * required for the admin-only RPCs (supabase/migrations/0008) that were
 * locked out of the anon role because the anon key is public (shipped as
 * NEXT_PUBLIC_SUPABASE_ANON_KEY) and would otherwise let anyone bypass
 * ADMIN_TOKEN by calling those RPCs directly. Never import getSupabaseAdmin
 * in anything reachable from a public/unauthenticated route.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

function resolveEnv(keys: string[]): string {
  for (const key of keys) {
    const val = process.env[key]
    if (val && val.trim() !== '') return val.trim()
  }
  throw new Error(
    `[supabase-server] None of the following env vars are set: ${keys.join(', ')}. ` +
      'Add them to .env.local and restart the dev server.'
  )
}

let _client: SupabaseClient | null = null
let _adminClient: SupabaseClient | null = null

/**
 * Returns a singleton Supabase client configured for server-side use.
 * Throws at module evaluation time if required env vars are missing so
 * you get a clear error on startup instead of a runtime 500.
 */
export function getSupabaseServer(): SupabaseClient {
  if (_client) return _client

  const supabaseUrl = resolveEnv([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ])

  const supabaseKey = resolveEnv([
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ])

  _client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      // Server route handlers don't need session persistence
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return _client
}

/**
 * Returns a singleton Supabase client authenticated as service_role —
 * bypasses RLS and is the only role granted EXECUTE on the admin-only RPCs
 * (see supabase/migrations/0008_harden_function_access.sql). Only call this
 * from code paths already gated by ADMIN_TOKEN (app/api/admin/*, and the
 * error/bug-report read/clear paths).
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient

  const supabaseUrl = resolveEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'])
  const serviceRoleKey = resolveEnv(['SUPABASE_SERVICE_ROLE_KEY'])

  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return _adminClient
}
