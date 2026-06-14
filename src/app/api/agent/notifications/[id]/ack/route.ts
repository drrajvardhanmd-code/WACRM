import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    const { error } = await supabase
      .from('agent_notifications')
      .update({ status: 'acknowledged' })
      .eq('id', id)
      .eq('user_id', authResult.userId)

    if (error) {
      console.error('[agent/notifications/[id]/ack] POST error:', error)
      return NextResponse.json({ error: 'Failed to acknowledge notification' }, { status: 500 })
    }

    // Log to audit
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    await supabase.from('agent_audit_log').insert({
      api_key_id: authResult.apiKeyId,
      user_id: authResult.userId,
      action: 'acknowledge_notification',
      resource_type: 'notification',
      resource_id: id,
      request_method: 'POST',
      request_path: new URL(request.url).pathname,
      request_body: null,
      response_status: 200,
      ip_address: ip
    }).then(({ error }) => { if (error) console.warn('[agent/notifications/[id]/ack] audit log failed:', error) })

    return NextResponse.json({ acknowledged: true, id })
  } catch (err) {
    console.error('[agent/notifications/[id]/ack] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
