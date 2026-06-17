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
