import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'templates:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { name } = await params
    const supabase = supabaseAdmin()
    
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', authResult.userId)
      .eq('name', name)

    if (error) {
      console.error('[agent/templates/[name]] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const variants = data.map(d => {
      // Find all matches of {{number}}
      const matches = d.body_text?.match(/\{\{\d+\}\}/g) || []
      // Find unique numbers
      const uniqueVariables = new Set(matches.map((m: string) => m.replace(/[{}]/g, '')))
      
      return {
        language: d.language,
        status: d.status,
        body_text: d.body_text,
        variables_count: uniqueVariables.size,
        buttons: d.buttons || []
      }
    })

    return NextResponse.json({ name, variants })
  } catch (err) {
    console.error('[agent/templates/[name]] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
