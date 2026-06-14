import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'broadcasts:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // 1. Fetch broadcast
    const { data: broadcast, error } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (error || !broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    // 2. Fetch recipients
    const { data: recipients } = await supabase
      .from('broadcast_recipients')
      .select('id, contact:contacts(id, name, phone), status, sent_at, delivered_at, read_at, error_message')
      .eq('broadcast_id', id)
      .order('created_at', { ascending: false })
      .limit(1000) // reasonable limit for API response

    return NextResponse.json({
      ...broadcast,
      recipients: recipients || []
    })

  } catch (err) {
    console.error('[agent/broadcasts/[id]] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
