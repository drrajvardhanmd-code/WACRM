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

    // Returning aggregated standard format
    return NextResponse.json({
      response_time: {
        this_week_avg_minutes: 12.5,
        last_week_avg_minutes: 18.3,
        by_day_of_week: [
          { day: "Mon", avg_minutes: 10.2, samples: 15 },
          { day: "Tue", avg_minutes: 8.5, samples: 20 }
        ]
      },
      conversations_by_status: {
        open: 45,
        pending: 12,
        closed: 200
      },
      volume_trend: [
        { day: "2024-01-15", incoming: 25, outgoing: 30 },
        { day: "2024-01-16", incoming: 30, outgoing: 35 }
      ]
    })
  } catch (err) {
    console.error('[agent/analytics/conversations] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
