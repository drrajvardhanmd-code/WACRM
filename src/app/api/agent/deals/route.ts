import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'deals:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20') || 20, 100)
    
    const pipelineId = searchParams.get('pipeline_id')
    const stageId = searchParams.get('stage_id')
    const status = searchParams.get('status') || 'open'
    const contactId = searchParams.get('contact_id')
    const minValue = searchParams.get('min_value')
    const maxValue = searchParams.get('max_value')

    const supabase = supabaseAdmin()

    let summaryQuery = supabase
      .from('deals')
      .select('status, value, stage:pipeline_stages(name)')
      .eq('user_id', authResult.userId)

    let query = supabase
      .from('deals')
      .select('*, pipeline:pipelines(id, name), stage:pipeline_stages(id, name, color), contact:contacts(id, name, phone)', { count: 'exact' })
      .eq('user_id', authResult.userId)

    if (pipelineId) {
      summaryQuery = summaryQuery.eq('pipeline_id', pipelineId)
      query = query.eq('pipeline_id', pipelineId)
    }
    if (stageId) {
      summaryQuery = summaryQuery.eq('stage_id', stageId)
      query = query.eq('stage_id', stageId)
    }
    if (status) {
      summaryQuery = summaryQuery.eq('status', status)
      query = query.eq('status', status)
    }
    if (contactId) {
      summaryQuery = summaryQuery.eq('contact_id', contactId)
      query = query.eq('contact_id', contactId)
    }
    if (minValue) {
      summaryQuery = summaryQuery.gte('value', minValue)
      query = query.gte('value', minValue)
    }
    if (maxValue) {
      summaryQuery = summaryQuery.lte('value', maxValue)
      query = query.lte('value', maxValue)
    }

    const { data: allDeals } = await summaryQuery

    let totalOpenDeals = 0
    let totalValue = 0
    const stageMap: Record<string, { count: number, value: number }> = {}

    if (allDeals) {
      for (const d of allDeals) {
        if (d.status === 'open' || d.status === 'active') {
          totalOpenDeals++
          totalValue += Number(d.value) || 0
        }
        
        // Ensure stage object exists to access name
        const stageName = (d.stage as any)?.name || 'Unknown'
        if (!stageMap[stageName]) stageMap[stageName] = { count: 0, value: 0 }
        stageMap[stageName].count++
        stageMap[stageName].value += Number(d.value) || 0
      }
    }

    const byStage = Object.entries(stageMap).map(([stage, stats]) => ({
      stage,
      count: stats.count,
      value: stats.value
    }))

    query = query.order('created_at', { ascending: false })
    const from = (page - 1) * perPage
    const to = page * perPage - 1
    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) {
      console.error('[agent/deals] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const totalPages = Math.ceil((count || 0) / perPage)

    return NextResponse.json({
      data: data || [],
      summary: {
        total_open_deals: totalOpenDeals,
        total_value: totalValue,
        by_stage: byStage
      },
      count: count || 0,
      page,
      per_page: perPage,
      total_pages: totalPages
    })
  } catch (err) {
    console.error('[agent/deals] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'deals:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { title, pipeline_id, stage_id, contact_id, value, currency, notes, expected_close_date } = body

    if (!title || !pipeline_id || !stage_id || !contact_id) {
      return NextResponse.json({ error: 'Missing required fields: title, pipeline_id, stage_id, contact_id' }, { status: 400 })
    }

    const supabase = supabaseAdmin()
    const { data, error } = await supabase
      .from('deals')
      .insert({
        user_id: authResult.userId,
        title,
        pipeline_id,
        stage_id,
        contact_id,
        value: value || 0,
        currency: currency || 'INR',
        notes: notes || null,
        expected_close_date: expected_close_date || null,
        status: 'open'
      })
      .select()
      .single()

    if (error) {
      console.error('[agent/deals] POST error:', error)
      return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error('[agent/deals] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
