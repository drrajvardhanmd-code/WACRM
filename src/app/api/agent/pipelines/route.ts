import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'pipelines:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const supabase = supabaseAdmin()
    
    // Fetch pipelines
    const { data: pipelines, error: pipeError } = await supabase
      .from('pipelines')
      .select('*')
      .eq('user_id', authResult.userId)
      
    if (pipeError || !pipelines) {
      console.error('[agent/pipelines] Fetch error:', pipeError)
      return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 })
    }

    if (pipelines.length === 0) {
      return NextResponse.json({ data: [] })
    }
    
    // Fetch stages
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('*')
      .in('pipeline_id', pipelines.map(p => p.id))
      .order('position', { ascending: true })
      
    // Fetch deals to compute counts
    const { data: deals } = await supabase
      .from('deals')
      .select('pipeline_id, stage_id, value')
      .eq('user_id', authResult.userId)
      .neq('status', 'lost') // exclude lost deals from pipeline value

    const formattedData = pipelines.map(p => {
      const pStages = stages?.filter(s => s.pipeline_id === p.id) || []
      
      let totalDeals = 0
      let totalValue = 0

      const formattedStages = pStages.map(s => {
        const stageDeals = deals?.filter(d => d.stage_id === s.id) || []
        const dealCount = stageDeals.length
        const stageValue = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
        
        totalDeals += dealCount
        totalValue += stageValue
        
        return {
          id: s.id,
          name: s.name,
          position: s.position,
          color: s.color,
          deal_count: dealCount,
          total_value: stageValue
        }
      })

      return {
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        stages: formattedStages,
        total_deals: totalDeals,
        total_value: totalValue
      }
    })

    return NextResponse.json({ data: formattedData })
  } catch (err) {
    console.error('[agent/pipelines] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
