import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'automations:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20') || 20, 100)

    const supabase = supabaseAdmin()
    let query = supabase
      .from('automations')
      .select('id, name, description, trigger_type, is_active, execution_count, last_executed_at, created_at', { count: 'exact' })
      .eq('user_id', authResult.userId)
      .order('created_at', { ascending: false })

    const from = (page - 1) * perPage
    const to = page * perPage - 1
    query = query.range(from, to)

    const { data, count, error } = await query
    
    if (error) {
      console.error('[agent/automations] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    
    // fetch step counts
    const autoIds = data?.map(d => d.id) || []
    let stepCounts: Record<string, number> = {}
    if (autoIds.length > 0) {
      const { data: steps } = await supabase
        .from('automation_steps')
        .select('automation_id')
        .in('automation_id', autoIds)
        
      if (steps) {
        steps.forEach(s => {
          stepCounts[s.automation_id] = (stepCounts[s.automation_id] || 0) + 1
        })
      }
    }

    const formatted = data?.map(d => ({ ...d, step_count: stepCounts[d.id] || 0 }))

    return NextResponse.json({ data: formatted || [], count: count || 0 })
  } catch (err) {
    console.error('[agent/automations] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'automations:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, trigger_type, trigger_config, steps } = body

    if (!name || !trigger_type) {
      return NextResponse.json({ error: 'name and trigger_type are required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()
    const { data: auto, error } = await supabase.from('automations').insert({
      user_id: authResult.userId,
      name,
      description,
      trigger_type,
      trigger_config: trigger_config || {},
      is_active: false
    }).select().single()

    if (error || !auto) {
      console.error('[agent/automations] POST error:', error)
      return NextResponse.json({ error: 'Failed to create automation' }, { status: 500 })
    }

    if (steps && Array.isArray(steps) && steps.length > 0) {
      const stepRows = steps.map((s, index) => ({
        automation_id: auto.id,
        step_type: s.step_type,
        step_config: s.step_config || {},
        position: s.position !== undefined ? s.position : index
      }))
      const { error: stepsError } = await supabase.from('automation_steps').insert(stepRows)
      if (stepsError) {
        console.error('[agent/automations] POST steps error:', stepsError)
      }
    }

    const { data: fullAuto } = await supabase
      .from('automations')
      .select('*, steps:automation_steps(*)')
      .eq('id', auto.id)
      .single()
      
    return NextResponse.json(fullAuto, { status: 201 })
  } catch (err) {
    console.error('[agent/automations] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
