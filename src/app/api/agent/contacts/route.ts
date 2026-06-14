import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sanitizePhoneForMeta, phonesMatch } from '@/lib/whatsapp/phone-utils'
import type { PaginatedResponse } from '@/lib/agent/types'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'contacts:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '20') || 20, 100)
    const q = searchParams.get('q')
    const tagId = searchParams.get('tag_id')
    const hasConversation = searchParams.get('has_conversation') === 'true'
    const createdAfter = searchParams.get('created_after')
    const createdBefore = searchParams.get('created_before')
    const sortBy = searchParams.get('sort_by') || 'created_at'
    const sortOrder = searchParams.get('sort_order') || 'desc'

    const supabase = supabaseAdmin()

    let selectString = '*, tags:contact_tags(tags(id, name, color)), conversations(id, last_message_at)'
    if (hasConversation) {
      selectString = '*, tags:contact_tags(tags(id, name, color)), conversations!inner(id, last_message_at)'
    }
    
    let query = supabase
      .from('contacts')
      .select(selectString, { count: 'exact' })
      .eq('user_id', authResult.userId)

    if (q) {
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`)
    }

    if (tagId) {
      const { data: tagContacts } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', tagId)
      
      const contactIds = tagContacts?.map(tc => tc.contact_id) || []
      query = query.in('id', contactIds.length > 0 ? contactIds : ['00000000-0000-0000-0000-000000000000'])
    }

    if (createdAfter) {
      query = query.gte('created_at', createdAfter)
    }

    if (createdBefore) {
      query = query.lte('created_at', createdBefore)
    }

    query = query.order(sortBy, { ascending: sortOrder === 'asc' })

    const from = (page - 1) * perPage
    const to = page * perPage - 1
    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) {
      console.error('[agent/contacts] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const formattedData = data.map((contact: any) => {
      const lastMessageAt = contact.conversations
        ?.map((c: any) => c.last_message_at)
        .filter(Boolean)
        .sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime())[0] || null

      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
        avatar_url: contact.avatar_url,
        created_at: contact.created_at,
        updated_at: contact.updated_at,
        tags: contact.tags
          ?.filter((ct: any) => ct.tags)
          .map((ct: any) => ct.tags) || [],
        conversation_count: contact.conversations?.length || 0,
        last_message_at: lastMessageAt
      }
    })

    const totalPages = Math.ceil((count || 0) / perPage)

    return NextResponse.json({
      data: formattedData,
      count: count || 0,
      page,
      per_page: perPage,
      total_pages: totalPages
    } as PaginatedResponse<any>)

  } catch (err) {
    console.error('[agent/contacts] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'contacts:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { name, phone, email, company, tag_ids } = body

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const sanitizedPhone = sanitizePhoneForMeta(phone)
    if (!sanitizedPhone) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // Check for duplicate phone (fetch suffix matches to minimize transfer)
    const suffix = sanitizedPhone.length >= 8 ? sanitizedPhone.slice(-8) : sanitizedPhone
    const { data: potentialDups } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('user_id', authResult.userId)
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
      return NextResponse.json({ error: 'Contact already exists', existing_id: duplicateId }, { status: 409 })
    }

    // Insert contact
    const { data: newContact, error: insertError } = await supabase
      .from('contacts')
      .insert({
        user_id: authResult.userId,
        name: name || null,
        phone: sanitizedPhone,
        email: email || null,
        company: company || null
      })
      .select()
      .single()

    if (insertError || !newContact) {
      console.error('[agent/contacts] POST insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
    }

    // Insert tags
    if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
      const tagInserts = tag_ids.map(tagId => ({
        contact_id: newContact.id,
        tag_id: tagId
      }))
      // Best effort tag insertion, failure here shouldn't fail the whole request
      const { error: tagError } = await supabase.from('contact_tags').insert(tagInserts)
      if (tagError) {
        console.warn('[agent/contacts] Failed to insert tags:', tagError)
      }
    }

    return NextResponse.json({
      id: newContact.id,
      name: newContact.name,
      phone: newContact.phone,
      email: newContact.email,
      company: newContact.company,
      created_at: newContact.created_at
    }, { status: 201 })

  } catch (err) {
    console.error('[agent/contacts] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
