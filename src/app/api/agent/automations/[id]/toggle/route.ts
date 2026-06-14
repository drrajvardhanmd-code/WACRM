import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'automations:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // Fetch current state
    const { data: auto, error: fetchErr } = await supabase
      .from('automations')
      .select('is_active')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (fetchErr || !auto) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const newStatus = !auto.is_active
    const now = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from('automations')
      .update({ is_active: newStatus, updated_at: now })
      .eq('id', id)

    if (updateErr) {
      console.error('[agent/automations/[id]/toggle] update error:', updateErr)
      return NextResponse.json({ error: 'Failed to toggle automation' }, { status: 500 })
    }

    return NextResponse.json({
      id,
      is_active: newStatus,
      toggled_at: now
    })
  } catch (err) {
    console.error('[agent/automations/[id]/toggle] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
