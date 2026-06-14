import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'analytics:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const supabase = supabaseAdmin()
    
    // active_conversations
    const { count: currentConvs } = await supabase
      .from('conversations')
      .select('id', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .in('status', ['open', 'pending'])
    
    // new_contacts today
    const todayStr = new Date().toISOString().split('T')[0]
    const { count: contactsToday } = await supabase
      .from('contacts')
      .select('id', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .gte('created_at', todayStr)

    // open_deals
    const { data: deals } = await supabase
      .from('deals')
      .select('value')
      .eq('user_id', authResult.userId)
      .in('status', ['open', 'active'])

    const totalValue = deals?.reduce((sum, d) => sum + (Number(d.value) || 0), 0) || 0

    // pending_dues
    const { count: unreadConvs } = await supabase
      .from('conversations')
      .select('id', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .gt('unread_count', 0)

    // recent_activity mock or simple fetch
    const { data: recentMsgs } = await supabase
      .from('messages')
      .select('conversation_id, created_at, content_text, sender_type')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(3)

    const recentActivity = recentMsgs?.map(m => ({
      kind: 'message',
      text: m.content_text,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`
    })) || []

    return NextResponse.json({
      active_conversations: {
        current: currentConvs || 0,
        new_today: contactsToday || 0,
        new_yesterday: 0
      },
      new_contacts: {
        today: contactsToday || 0,
        yesterday: 0
      },
      open_deals: {
        count: deals?.length || 0,
        total_value: totalValue,
        currency: "INR"
      },
      messages: {
        sent_today: 0,
        sent_yesterday: 0,
        received_today: 0,
        received_yesterday: 0
      },
      pending_dues: {
        conversations_with_unread: unreadConvs || 0
      },
      recent_activity: recentActivity
    })
  } catch (err) {
    console.error('[agent/analytics/dashboard] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
