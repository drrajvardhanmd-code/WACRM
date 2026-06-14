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

    const { data: auto, error } = await supabase
      .from('automations')
      .select('*, steps:automation_steps(*)')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (error || !auto) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    // Sort steps by position
    if (auto.steps) {
      auto.steps.sort((a: any, b: any) => a.position - b.position)
    }

    return NextResponse.json(auto)
  } catch (err) {
    console.error('[agent/automations/[id]] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'automations:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const updates: any = { updated_at: new Date().toISOString() }

    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.trigger_type !== undefined) updates.trigger_type = body.trigger_type
    if (body.trigger_config !== undefined) updates.trigger_config = body.trigger_config
    if (body.is_active !== undefined) updates.is_active = body.is_active

    const supabase = supabaseAdmin()
    const { data, error } = await supabase
      .from('automations')
      .update(updates)
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .select()
      .single()

    if (error || !data) {
      console.error('[agent/automations/[id]] PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update automation' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[agent/automations/[id]] PATCH exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
