import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomBytes, createHash } from 'crypto'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('agent_api_keys')
      .select('id, label, is_active, last_used_at, created_at, expires_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[settings/api-keys GET] Database error:', error)
      return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[settings/api-keys GET] Exception:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { label } = body

    if (!label || typeof label !== 'string' || label.trim() === '') {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 })
    }

    // Generate a secure random 32-byte key and hex encode it
    const rawKey = randomBytes(32).toString('hex')
    // Hash it for storage
    const keyHash = createHash('sha512').update(rawKey).digest('hex')

    const { data, error } = await supabase
      .from('agent_api_keys')
      .insert({
        user_id: user.id,
        label: label.trim(),
        key_hash: keyHash,
        scopes: ['admin'], // Default to admin scope for ease of use with integrations
        is_active: true
      })
      .select('id, label, is_active, last_used_at, created_at, expires_at')
      .single()

    if (error) {
      console.error('[settings/api-keys POST] Database error:', error)
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
    }

    // Return the raw key just this once
    return NextResponse.json({ data: { ...data, rawKey } }, { status: 201 })
  } catch (error) {
    console.error('[settings/api-keys POST] Exception:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
