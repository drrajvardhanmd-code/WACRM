import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')
    const senderType = searchParams.get('sender_type')

    if (!q || !q.trim()) {
      return NextResponse.json({ error: 'q parameter is required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Verify conversation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    let query = supabase
      .from('messages')
      .select('id, sender_type, content_text, created_at', { count: 'exact' })
      .eq('conversation_id', id)
      .ilike('content_text', `%${q}%`)

    if (senderType) {
      query = query.eq('sender_type', senderType)
    }

    query = query.order('created_at', { ascending: false }).limit(100)

    const { data, count, error } = await query

    if (error) {
      console.error('[agent/conversations/[id]/search] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Generate highlight text
    const searchRegex = new RegExp(`(${escapeRegExp(q.trim())})`, 'gi')
    
    const formattedData = data?.map(msg => ({
      id: msg.id,
      sender_type: msg.sender_type,
      content_text: msg.content_text,
      created_at: msg.created_at,
      highlight: msg.content_text?.replace(searchRegex, '<mark>$1</mark>') || null
    })) || []

    return NextResponse.json({
      data: formattedData,
      count: count || 0
    })

  } catch (err) {
    console.error('[agent/conversations/[id]/search] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
