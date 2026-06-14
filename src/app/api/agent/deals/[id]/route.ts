import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'deals:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const updates: any = { updated_at: new Date().toISOString() }

    if (body.stage_id !== undefined) updates.stage_id = body.stage_id
    if (body.value !== undefined) updates.value = body.value
    if (body.status !== undefined) updates.status = body.status
    if (body.notes !== undefined) updates.notes = body.notes
    if (body.expected_close_date !== undefined) updates.expected_close_date = body.expected_close_date

    const supabase = supabaseAdmin()
    const { data, error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .select()
      .single()

    if (error || !data) {
      console.error('[agent/deals/[id]] PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update deal' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[agent/deals/[id]] PATCH exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
