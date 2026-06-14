import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import type { PaginatedResponse } from '@/lib/agent/types'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'conversations:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20') || 20, 100)
    
    const statuses = searchParams.getAll('status')
    const contactId = searchParams.get('contact_id')
    const contactPhone = searchParams.get('contact_phone')
    const contactName = searchParams.get('contact_name')
    const assignedAgentId = searchParams.get('assigned_agent_id')
    const hasUnread = searchParams.get('has_unread') === 'true'
    const lastMessageAfter = searchParams.get('last_message_after')
    const lastMessageBefore = searchParams.get('last_message_before')
    const sortBy = searchParams.get('sort_by') || 'last_message_at'
    const sortOrder = searchParams.get('sort_order') || 'desc'

    const supabase = supabaseAdmin()

    let selectString = '*, contact:contacts(id, name, phone, avatar_url)'
    if (contactPhone || contactName) {
      // Need !inner join to filter on embedded resource
      selectString = '*, contact:contacts!inner(id, name, phone, avatar_url)'
    }

    let query = supabase
      .from('conversations')
      .select(selectString, { count: 'exact' })
      .eq('user_id', authResult.userId)

    if (statuses.length > 0) {
      query = query.in('status', statuses)
    }

    if (contactId) {
      query = query.eq('contact_id', contactId)
    }

    if (assignedAgentId) {
      query = query.eq('assigned_agent_id', assignedAgentId)
    }

    if (hasUnread) {
      query = query.gt('unread_count', 0)
    }

    if (lastMessageAfter) {
      query = query.gte('last_message_at', lastMessageAfter)
    }

    if (lastMessageBefore) {
      query = query.lte('last_message_at', lastMessageBefore)
    }

    if (contactName) {
      query = query.ilike('contact.name', `%${contactName}%`)
    }

    if (contactPhone) {
      const normalized = normalizePhone(contactPhone)
      if (normalized) {
        query = query.ilike('contact.phone', `%${normalized}%`)
      }
    }

    query = query.order(sortBy, { ascending: sortOrder === 'asc' })

    const from = (page - 1) * perPage
    const to = page * perPage - 1
    query = query.range(from, to)

    const { data: conversations, count, error } = await query

    if (error) {
      console.error('[agent/conversations] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // 2. Fetch latest customer message for message_window calculation
    let latestCustomerMsgMap: Record<string, string> = {}
    
    if (conversations && conversations.length > 0) {
      const convIds = (conversations as any[]).map(c => c.id)
      const { data: customerMsgs, error: msgError } = await supabase
        .from('messages')
        .select('conversation_id, created_at')
        .in('conversation_id', convIds)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })

      if (!msgError && customerMsgs) {
        for (const msg of customerMsgs) {
          if (!latestCustomerMsgMap[msg.conversation_id]) {
            latestCustomerMsgMap[msg.conversation_id] = msg.created_at
          }
        }
      }
    }

    const now = new Date()
    const formattedData = (conversations as any[])?.map(conv => {
      const messageWindow: any = {
        is_open: false,
        expires_at: null,
        hours_remaining: null
      }

      const lastCustomerMsgTime = latestCustomerMsgMap[conv.id]
      if (lastCustomerMsgTime) {
        const lastMsgDate = new Date(lastCustomerMsgTime)
        const expiresAtDate = new Date(lastMsgDate.getTime() + 24 * 60 * 60 * 1000)
        
        if (now < expiresAtDate) {
          messageWindow.is_open = true
          messageWindow.expires_at = expiresAtDate.toISOString()
          // Round to 1 decimal place
          const hoursRemaining = (expiresAtDate.getTime() - now.getTime()) / (1000 * 60 * 60)
          messageWindow.hours_remaining = Math.round(hoursRemaining * 10) / 10
        }
      }

      return {
        id: conv.id,
        contact: conv.contact,
        status: conv.status,
        assigned_agent_id: conv.assigned_agent_id,
        last_message_text: conv.last_message_text,
        last_message_at: conv.last_message_at,
        unread_count: conv.unread_count,
        created_at: conv.created_at,
        message_window: messageWindow
      }
    }) || []

    const totalPages = Math.ceil((count || 0) / perPage)

    return NextResponse.json({
      data: formattedData,
      count: count || 0,
      page,
      per_page: perPage,
      total_pages: totalPages
    } as PaginatedResponse<any>)

  } catch (err) {
    console.error('[agent/conversations] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
