import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sanitizePhoneForMeta, phonesMatch } from '@/lib/whatsapp/phone-utils'

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

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*, tags:contact_tags(tags(id, name, color)), notes:contact_notes(id, note_text, created_at), custom_fields:contact_custom_values(value, custom_fields(field_name)), conversations(id, status, last_message_text, last_message_at, unread_count)')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .single()

    if (error || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // Format response
    return NextResponse.json({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
      avatar_url: contact.avatar_url,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
      tags: contact.tags?.filter((ct: any) => ct.tags).map((ct: any) => ct.tags) || [],
      notes: contact.notes || [],
      custom_fields: contact.custom_fields?.map((cv: any) => ({
        field_name: cv.custom_fields?.field_name,
        value: cv.value
      })) || [],
      conversations: contact.conversations || []
    })
  } catch (err) {
    console.error('[agent/contacts/[id]] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const { name, email, company, phone, avatar_url } = body

    const supabase = supabaseAdmin()

    // Build update payload
    const updates: any = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (email !== undefined) updates.email = email
    if (company !== undefined) updates.company = company
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    if (phone !== undefined) {
      const sanitizedPhone = sanitizePhoneForMeta(phone)
      if (!sanitizedPhone) {
        return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
      }

      // Check for duplicates
      const suffix = sanitizedPhone.length >= 8 ? sanitizedPhone.slice(-8) : sanitizedPhone
      const { data: potentialDups } = await supabase
        .from('contacts')
        .select('id, phone')
        .eq('user_id', authResult.userId)
        .neq('id', id)
        .ilike('phone', `%${suffix}`)

      let duplicateId = null
      if (potentialDups && potentialDups.length > 0) {
        for (const c of potentialDups) {
          if (c.phone && phonesMatch(c.phone, sanitizedPhone)) {
            duplicateId = c.id
            break
          }
        }
      }

      if (duplicateId) {
        return NextResponse.json({ error: 'Contact already exists with this phone number', existing_id: duplicateId }, { status: 409 })
      }

      updates.phone = sanitizedPhone
    }

    const { data: updatedContact, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .select()
      .single()

    if (error || !updatedContact) {
      return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
    }

    return NextResponse.json(updatedContact)
  } catch (err) {
    console.error('[agent/contacts/[id]] PATCH exception:', err)
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
    const supabase = supabaseAdmin()

    // Delete contact - cascading handles tags, notes, and custom_values
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', authResult.userId)

    if (error) {
      console.error('[agent/contacts/[id]] DELETE error:', error)
      return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
    }

    return NextResponse.json({ deleted: true, id })
  } catch (err) {
    console.error('[agent/contacts/[id]] DELETE exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
