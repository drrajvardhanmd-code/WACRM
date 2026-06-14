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
    let body: any = {}
    
    // Body can be empty or null depending on fetch client if not setting it explicitly when unassigning, 
    // but the spec expects `{ "agent_id": null }` or `{ "agent_id": "uuid" }`
    try {
      const text = await request.text()
      if (text) body = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const agentId = body.agent_id !== undefined ? body.agent_id : undefined
    
    if (agentId === undefined) {
      return NextResponse.json({ error: 'agent_id is required (can be null to unassign)' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Fetch conversation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // Update assigned_agent_id
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        assigned_agent_id: agentId,
        updated_at: now
      })
      .eq('id', id)

    if (updateError) {
      console.error('[agent/conversations/[id]/assign] error updating assignment:', updateError)
      return NextResponse.json({ error: 'Failed to assign conversation' }, { status: 500 })
    }

    // Log to audit
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    await supabase.from('agent_audit_log').insert({
      api_key_id: authResult.apiKeyId,
      user_id: authResult.userId,
      action: agentId ? 'assign_conversation' : 'unassign_conversation',
      resource_type: 'conversation',
      resource_id: id,
      request_method: 'POST',
      request_path: new URL(request.url).pathname,
      request_body: body,
      response_status: 200,
      ip_address: ip
    }).catch(e => console.warn('[agent/conversations/[id]/assign] audit log failed:', e))

    return NextResponse.json({ success: true, id, assigned_agent_id: agentId, updated_at: now })
  } catch (err) {
    console.error('[agent/conversations/[id]/assign] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
