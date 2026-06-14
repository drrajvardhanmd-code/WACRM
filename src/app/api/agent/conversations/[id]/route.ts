import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'conversations:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // 1. Fetch conversation with contact and recent messages
    const { data: conv, error } = await supabase
      .from('conversations')
      .select(`
        id, status, assigned_agent_id, last_message_text, last_message_at, unread_count, created_at,
        contact:contacts(id, name, phone, avatar_url),
        messages(
          id, sender_type, content_type, content_text, status, created_at,
          reply_to_message_id, interactive_reply_id
        )
      `)
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .order('created_at', { foreignTable: 'messages', ascending: false })
      .limit(50, { foreignTable: 'messages' })
      .single()

    if (error || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // 2. Determine latest customer message for message_window
    // We do a separate query because the recent_messages limit might exclude an older customer message 
    // that is still within 24 hours.
    const { data: lastCustomerMsg } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const messageWindow: any = {
      is_open: false,
      expires_at: null,
      hours_remaining: null
    }

    if (lastCustomerMsg) {
      const now = new Date()
      const lastMsgDate = new Date(lastCustomerMsg.created_at)
      const expiresAtDate = new Date(lastMsgDate.getTime() + 24 * 60 * 60 * 1000)
      
      if (now < expiresAtDate) {
        messageWindow.is_open = true
        messageWindow.expires_at = expiresAtDate.toISOString()
        const hoursRemaining = (expiresAtDate.getTime() - now.getTime()) / (1000 * 60 * 60)
        messageWindow.hours_remaining = Math.round(hoursRemaining * 10) / 10
      }
    }

    return NextResponse.json({
      id: conv.id,
      contact: conv.contact,
      status: conv.status,
      assigned_agent_id: conv.assigned_agent_id,
      last_message_text: conv.last_message_text,
      last_message_at: conv.last_message_at,
      unread_count: conv.unread_count,
      created_at: conv.created_at,
      message_window: messageWindow,
      recent_messages: conv.messages || []
    })

  } catch (err) {
    console.error('[agent/conversations/[id]] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
