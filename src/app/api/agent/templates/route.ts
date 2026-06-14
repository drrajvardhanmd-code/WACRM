import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'templates:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    const language = searchParams.get('language')

    const supabase = supabaseAdmin()
    let query = supabase.from('message_templates').select('*', { count: 'exact' }).eq('user_id', authResult.userId)

    if (status) query = query.eq('status', status.toUpperCase())
    if (category) query = query.eq('category', category)
    if (language) query = query.eq('language', language)

    const { data, count, error } = await query
    
    if (error) {
      console.error('[agent/templates] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json({ data: data || [], count: count || 0 })
  } catch (err) {
    console.error('[agent/templates] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
