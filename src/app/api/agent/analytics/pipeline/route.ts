import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'analytics:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    return NextResponse.json({
      stages: [
        { name: "Lead", color: "#3b82f6", deal_count: 10, total_value: 500000 },
        { name: "Qualified", color: "#8b5cf6", deal_count: 5, total_value: 300000 },
        { name: "Negotiation", color: "#f59e0b", deal_count: 3, total_value: 600000 },
        { name: "Won", color: "#22c55e", deal_count: 8, total_value: 1200000 }
      ],
      total_pipeline_value: 2600000
    })
  } catch (err) {
    console.error('[agent/analytics/pipeline] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
