import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'
    const type = searchParams.get('type')
    const since = searchParams.get('since')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 200)

    const supabase = supabaseAdmin()
    let query = supabase
      .from('agent_notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (type) query = query.eq('notification_type', type)
    if (since) query = query.gt('created_at', since)

    const { data, count, error } = await query
    
    // get unread_count
    const { count: unreadCount } = await supabase
      .from('agent_notifications')
      .select('id', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .eq('status', 'pending')

    if (error) {
      console.error('[agent/notifications] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0,
      unread_count: unreadCount || 0
    })
  } catch (err) {
    console.error('[agent/notifications] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
