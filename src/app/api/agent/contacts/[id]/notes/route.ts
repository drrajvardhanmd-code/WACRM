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

    // Verify contact belongs to user
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const { data: notes, error, count } = await supabase
      .from('contact_notes')
      .select('id, note_text, created_at', { count: 'exact' })
      .eq('contact_id', id)
      .eq('user_id', authResult.userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[agent/contacts/[id]/notes] GET error:', error)
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }

    return NextResponse.json({
      data: notes || [],
      count: count || 0
    })
  } catch (err) {
    console.error('[agent/contacts/[id]/notes] GET exception:', err)
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
    const { note_text } = body

    if (!note_text || typeof note_text !== 'string' || !note_text.trim()) {
      return NextResponse.json({ error: 'note_text is required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Verify contact belongs to user
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const { data: newNote, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: id,
        user_id: authResult.userId,
        note_text: note_text.trim()
      })
      .select('id, note_text, created_at')
      .single()

    if (error || !newNote) {
      console.error('[agent/contacts/[id]/notes] POST insert error:', error)
      return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
    }

    return NextResponse.json(newNote, { status: 201 })
  } catch (err) {
    console.error('[agent/contacts/[id]/notes] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
