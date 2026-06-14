import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/flows/admin-client'

import { type AgentAuthResult } from './types'

/**
 * Takes a plaintext API key and returns its SHA-512 hex digest.
 */
export function hashKey(plaintext: string): string {
  return createHash('sha512').update(plaintext).digest('hex')
}

/**
 * Authenticates an agent using the Authorization header.
 * 
 * Flow:
 * 1. Reads the `Authorization` header
 * 2. Expects format `Bearer <api_key>`
 * 3. Hashes the provided key using SHA-512
 * 4. Looks up the hash in `agent_api_keys` table where `is_active = true`
 * 5. Checks `expires_at` is null or in the future
 * 6. Returns `{ userId, apiKeyId, scopes, rateLimitRequests, rateLimitWindowSeconds }` on success
 * 7. Returns `{ error: string, status: number }` on failure
 */
export async function authenticateAgent(request: Request): Promise<AgentAuthResult> {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return { error: 'Missing Authorization header', status: 401 }
    }

    if (!authHeader.startsWith('Bearer ')) {
      return { error: 'Invalid Authorization format. Expected Bearer token', status: 401 }
    }

    const apiKey = authHeader.substring(7).trim()
    if (!apiKey) {
      return { error: 'Empty API key provided', status: 401 }
    }

    const keyHash = hashKey(apiKey)
    const supabase = supabaseAdmin()

    const { data: keyRow, error } = await supabase
      .from('agent_api_keys')
      .select('id, user_id, scopes, expires_at, rate_limit_requests, rate_limit_window_seconds')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (error || !keyRow) {
      return { error: 'Invalid or inactive API key', status: 401 }
    }

    // Check expiration
    if (keyRow.expires_at) {
      const expiresAt = new Date(keyRow.expires_at)
      if (expiresAt < new Date()) {
        return { error: 'API key expired', status: 401 }
      }
    }

    // Fire-and-forget update of last_used_at
    // We don't await this because we want to keep the auth path fast
    supabase
      .from('agent_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .then(({ error }) => {
        if (error) {
          console.warn('[agent/auth] Failed to update last_used_at:', error.message)
        }
      })

    return {
      userId: keyRow.user_id,
      apiKeyId: keyRow.id,
      scopes: keyRow.scopes,
      rateLimitRequests: keyRow.rate_limit_requests,
      rateLimitWindowSeconds: keyRow.rate_limit_window_seconds
    }
  } catch (error) {
    console.error('Error during agent authentication:', error)
    return { error: 'Internal server error during authentication', status: 500 }
  }
}

/**
 * Checks if the authenticated agent has a specific permission scope.
 */
export function requireScope(scopes: string[], required: string): boolean {
  if (!scopes || !Array.isArray(scopes)) return false
  
  // "admin" scope implicitly grants all permissions
  if (scopes.includes('admin')) return true
  
  return scopes.includes(required)
}
