import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'conversations:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // 2. Fetch conversation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // 4. Update conversation status
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        status: 'closed',
        updated_at: now
      })
      .eq('id', id)

    if (updateError) {
      console.error('[agent/conversations/[id]/close] error updating status:', updateError)
      return NextResponse.json({ error: 'Failed to close conversation' }, { status: 500 })
    }

    // 5. End active flow runs
    try {
      await supabase
        .from('flow_runs')
        .update({
          status: 'ended',
          ended_at: now,
          end_reason: 'conversation_closed'
        })
        .eq('user_id', authResult.userId)
        .eq('contact_id', conv.contact_id)
        .eq('status', 'active')
    } catch (e) {
      console.warn('[agent/conversations/[id]/close] flow_run update failed:', e)
    }

    // 6. Log to audit
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    await supabase.from('agent_audit_log').insert({
      api_key_id: authResult.apiKeyId,
      user_id: authResult.userId,
      action: 'close_conversation',
      resource_type: 'conversation',
      resource_id: id,
      request_method: 'POST',
      request_path: new URL(request.url).pathname,
      request_body: null,
      response_status: 200,
      ip_address: ip
    }).then(({ error }) => { if (error) console.warn('[agent/conversations/[id]/close] audit log failed:', error) })

    return NextResponse.json({ closed: true, id, closed_at: now })
  } catch (err) {
    console.error('[agent/conversations/[id]/close] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
