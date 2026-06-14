import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'automations:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // Verify automation belongs to user
    const { data: auto, error: autoError } = await supabase
      .from('automations')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (autoError || !auto) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const { data, count, error } = await supabase
      .from('automation_logs')
      .select('id, trigger_event, status, contact:contacts(name, phone), steps_executed, created_at', { count: 'exact' })
      .eq('automation_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[agent/automations/[id]/logs] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0
    })
  } catch (err) {
    console.error('[agent/automations/[id]/logs] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
