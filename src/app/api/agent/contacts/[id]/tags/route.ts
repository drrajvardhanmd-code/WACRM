import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'contacts:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const supabase = supabaseAdmin()

    // Verify contact
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const { data: tags, error } = await supabase
      .from('contact_tags')
      .select('tags(id, name, color)')
      .eq('contact_id', id)

    if (error) {
      console.error('[agent/contacts/[id]/tags] GET error:', error)
      return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 })
    }

    const formattedTags = tags?.filter(t => t.tags).map(t => t.tags) || []
    return NextResponse.json({ data: formattedTags })

  } catch (err) {
    console.error('[agent/contacts/[id]/tags] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'contacts:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { tag_id } = body

    if (!tag_id) {
      return NextResponse.json({ error: 'tag_id is required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Verify contact
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // Verify tag belongs to user
    const { data: tag, error: tagError } = await supabase
      .from('tags')
      .select('id')
      .eq('id', tag_id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (tagError || !tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    // Upsert
    const { error } = await supabase
      .from('contact_tags')
      .upsert({ contact_id: id, tag_id }, { onConflict: 'contact_id,tag_id' })

    if (error) {
      console.error('[agent/contacts/[id]/tags] POST upsert error:', error)
      return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[agent/contacts/[id]/tags] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'contacts:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { tag_id } = body

    if (!tag_id) {
      return NextResponse.json({ error: 'tag_id is required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Verify contact
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('contact_tags')
      .delete()
      .eq('contact_id', id)
      .eq('tag_id', tag_id)

    if (error) {
      console.error('[agent/contacts/[id]/tags] DELETE error:', error)
      return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 })
    }

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[agent/contacts/[id]/tags] DELETE exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
