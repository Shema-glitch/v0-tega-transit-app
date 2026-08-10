/**
 * lib/api/admin-totp.ts — Google Authenticator second factor for admins.
 *
 * Defense in depth on top of the Supabase magic-code login: an admin who
 * enrolls a TOTP secret must present a fresh authenticator code for sensitive
 * operations (stop writes, maintenance toggles, admin invite/revoke,
 * suggestion approval). If the admin's email is compromised, a hijacker who
 * reads the OTP emails still cannot act without the authenticator app.
 *
 * Storage: the `admin_totp` Supabase table (migration 0013) — RLS on, zero
 * anon/authenticated grants, service_role only. Enrollment is two-phase:
 * `pending_secret` is stored first (so the otpauth:// URI survives a refresh)
 * and is promoted to `secret` + `enabled_at` only after the admin proves they
 * scanned it by entering a valid code.
 *
 * Failure semantics for the sensitive-op gate: fail-open ONLY when the auth
 * store itself is unreachable — every write this gate protects also requires
 * Supabase, so a DB outage already blocks the destructive action. A reachable
 * store that says "not enrolled" or "no pending" is a real answer, not an
 * error, and never opens the gate.
 */

import { generateSecret, generateURI, verifySync } from 'otplib'
import { getSupabaseAdmin } from '../supabase-server'
import { readSessionCookiePayload, type AuthRequestLike } from './admin-auth'

export const TOTP_ISSUER = 'BusGo Track'
/** How long a verified authenticator code primes the session (sensitive-op grace). */
export const TOTP_GRACE_MS = 5 * 60 * 1000
/** ±30s around the current step — tolerates one-step clock drift on the phone. */
const EPOCH_TOLERANCE_SEC = 30

const MAX_FAILS = 5
const LOCK_MS = 5 * 60 * 1000

export interface TotpStatus {
  enabled: boolean
  enabledAt: number | null
  /** An enrollment was started but not yet activated (pending_secret set). */
  pending: boolean
  /** False when the auth store was unreachable — the gate fails open on that. */
  dbOk: boolean
}

export type TotpResult = { ok: true } | { ok: false; error: string; code?: string }

interface TotpRow {
  secret: string | null
  pending_secret: string | null
  enabled_at: string | null
}

// Per-email brute-force lockout (in-memory, mirrors auth-guard's per-IP state).
const attempts = new Map<string, { fails: number; lockedUntil: number }>()

function lockoutState(email: string): { locked: boolean; retryAfterSec: number } {
  const s = attempts.get(email)
  // lockedUntil === 0 means "counting fails, not locked yet" — never delete
  // the entry here, or the counter would reset on every attempt.
  if (!s || s.lockedUntil === 0) return { locked: false, retryAfterSec: 0 }
  if (s.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((s.lockedUntil - Date.now()) / 1000) }
  }
  // Lock expired — clear it so the counter restarts.
  attempts.delete(email)
  return { locked: false, retryAfterSec: 0 }
}

function recordFail(email: string): void {
  const s = attempts.get(email)
  const fails = (s?.fails ?? 0) + 1
  attempts.set(email, fails >= MAX_FAILS ? { fails, lockedUntil: Date.now() + LOCK_MS } : { fails, lockedUntil: 0 })
}

function recordSuccess(email: string): void {
  attempts.delete(email)
}

function verifyCode(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SEC }).valid
  } catch {
    return false
  }
}

async function readRow(email: string): Promise<TotpRow | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('admin_totp')
    .select('secret, pending_secret, enabled_at')
    .eq('email', email)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as TotpRow
}

/** Current TOTP state for an address. Never throws — see file doc. */
export async function getTotpStatus(email: string): Promise<TotpStatus> {
  try {
    const row = await readRow(email)
    if (!row) return { enabled: false, enabledAt: null, pending: false, dbOk: true }
    return {
      enabled: !!row.secret && !!row.enabled_at,
      enabledAt: row.enabled_at ? new Date(row.enabled_at).getTime() : null,
      pending: !!row.pending_secret,
      dbOk: true,
    }
  } catch {
    return { enabled: false, enabledAt: null, pending: false, dbOk: false }
  }
}

export interface TotpEnrollment {
  secret: string
  otpauthUri: string
}

/**
 * Starts enrollment: generates a fresh secret and stores it as pending. Refuses
 * when TOTP is already active. Returns the base32 secret + otpauth:// URI for
 * the admin to scan or type into Google Authenticator.
 */
export async function beginTotpEnrollment(
  email: string
): Promise<{ ok: true; enrollment: TotpEnrollment } | { ok: false; error: string; code?: string }> {
  const status = await getTotpStatus(email)
  if (status.enabled) {
    return { ok: false, error: 'Two-factor authentication is already enabled for this account.', code: 'already-enabled' }
  }

  const secret = generateSecret()
  const otpauthUri = generateURI({ issuer: TOTP_ISSUER, label: email, secret })
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('admin_totp').upsert(
      { email, pending_secret: secret, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    )
    if (error) return { ok: false, error: `Could not save the enrollment: ${error.message}` }
    return { ok: true, enrollment: { secret, otpauthUri } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the enrollment.' }
  }
}

/** Activates a pending enrollment — requires a valid code from the app. */
export async function activateTotp(email: string, code: string): Promise<TotpResult> {
  const lock = lockoutState(email)
  if (lock.locked) {
    return { ok: false, error: `Too many attempts. Try again in ${lock.retryAfterSec}s.`, code: 'locked' }
  }

  let row: TotpRow | null
  try {
    row = await readRow(email)
  } catch {
    return { ok: false, error: 'Could not reach the auth store.' }
  }
  if (!row?.pending_secret) {
    return { ok: false, error: 'No pending enrollment found — start setup again.', code: 'no-pending' }
  }
  if (!verifyCode(row.pending_secret, code)) {
    recordFail(email)
    return { ok: false, error: 'That code is not valid. Check the time on your phone and try again.' }
  }

  recordSuccess(email)
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('admin_totp')
      .update({
        secret: row.pending_secret,
        pending_secret: null,
        enabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('email', email)
    if (error) return { ok: false, error: `Could not activate two-factor: ${error.message}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not activate two-factor.' }
  }
}

/** Verifies a code against the active secret (used to prime the session). */
export async function verifyTotp(email: string, code: string): Promise<TotpResult> {
  const lock = lockoutState(email)
  if (lock.locked) {
    return { ok: false, error: `Too many attempts. Try again in ${lock.retryAfterSec}s.`, code: 'locked' }
  }

  let row: TotpRow | null
  try {
    row = await readRow(email)
  } catch {
    return { ok: false, error: 'Could not reach the auth store.' }
  }
  if (!row?.secret || !row.enabled_at) {
    return { ok: false, error: 'Two-factor authentication is not enabled for this account.', code: 'not-enabled' }
  }
  if (!verifyCode(row.secret, code)) {
    recordFail(email)
    return { ok: false, error: 'That code is not valid. Check the time on your phone and try again.' }
  }

  recordSuccess(email)
  return { ok: true }
}

/**
 * Disables TOTP — requires a valid code first, so a hijacker who got into the
 * session cannot simply switch the second factor off.
 */
export async function disableTotp(email: string, code: string): Promise<TotpResult> {
  const verified = await verifyTotp(email, code)
  if (!verified.ok) return verified
  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('admin_totp').delete().eq('email', email)
    if (error) return { ok: false, error: `Could not disable two-factor: ${error.message}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not disable two-factor.' }
  }
}

/**
 * The sensitive-action gate. Call after checkAdminAuth, with the authenticated
 * email. Allowed when:
 *   - the caller used the shared token (no TOTP concept — the shared secret is
 *     that path's boundary), or
 *   - the email has no active TOTP enrollment, or
 *   - a valid `x-totp-code` header was presented (stateless, for API scripts),
 *     or
 *   - the session cookie carries a `totpAt` claim younger than TOTP_GRACE_MS
 *     (the admin confirmed identity in the dashboard within the grace window).
 */
export async function requireTotpForAction(
  request: AuthRequestLike,
  email: string
): Promise<{ ok: true } | { ok: false; reason: 'totp-required' }> {
  if (email === 'shared-token') return { ok: true }

  let status: TotpStatus
  try {
    status = await getTotpStatus(email)
  } catch {
    status = { enabled: false, enabledAt: null, pending: false, dbOk: false }
  }
  if (!status.enabled) return { ok: true }

  const headerCode = request.headers.get('x-totp-code')
  if (headerCode && /^\d{6}$/.test(headerCode)) {
    const result = await verifyTotp(email, headerCode)
    if (result.ok) return { ok: true }
  }

  const payload = readSessionCookiePayload(request)
  if (payload?.totpAt && Date.now() - payload.totpAt <= TOTP_GRACE_MS) return { ok: true }

  return { ok: false, reason: 'totp-required' }
}
