import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import type { PaginatedResponse } from '@/lib/agent/types'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'conversations:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const perPage = Math.min(parseInt(searchParams.get('per_page') || '50') || 50, 100)
    
    const before = searchParams.get('before')
    const after = searchParams.get('after')
    const senderType = searchParams.get('sender_type')
    const contentType = searchParams.get('content_type')
    const search = searchParams.get('search')

    const supabase = supabaseAdmin()

    // Verify conversation
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('conversation_id', id)

    if (before) query = query.lte('created_at', before)
    if (after) query = query.gte('created_at', after)
    if (senderType) query = query.eq('sender_type', senderType)
    if (contentType) query = query.eq('content_type', contentType)
    if (search) query = query.ilike('content_text', `%${search}%`)

    // Chronological order for pagination
    query = query.order('created_at', { ascending: true })

    const from = (page - 1) * perPage
    const to = page * perPage - 1
    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) {
      console.error('[agent/messages] GET error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const totalPages = Math.ceil((count || 0) / perPage)

    return NextResponse.json({
      data: data || [],
      count: count || 0,
      page,
      per_page: perPage,
      total_pages: totalPages
    } as PaginatedResponse<any>)

  } catch (err) {
    console.error('[agent/messages] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'conversations:write') || !requireScope(authResult.scopes || [], 'messages:send')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const bodyText = await request.text()
    let body: any = {}
    try {
      body = JSON.parse(bodyText)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const {
      message_type,
      content_text,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id
    } = body

    if (!message_type || (message_type === 'text' && !content_text) || (message_type === 'template' && !template_name)) {
      return NextResponse.json({ error: 'message_type and content_text/template_name are required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // 5. Fetch conversation + contact
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', id)
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (conv.status === 'closed') {
      return NextResponse.json({ error: 'Conversation is closed' }, { status: 409 })
    }

    const contact = conv.contact
    if (!contact?.phone) {
      return NextResponse.json({ error: 'Contact phone number not found' }, { status: 400 })
    }

    // 8. Check 24-hour window
    if (message_type === 'text') {
      const { data: lastCustMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const now = new Date()
      let isWindowOpen = false
      if (lastCustMsg) {
        const lastMsgDate = new Date(lastCustMsg.created_at)
        const expiryDate = new Date(lastMsgDate.getTime() + 24 * 60 * 60 * 1000)
        if (now < expiryDate) {
          isWindowOpen = true
        }
      }

      if (!isWindowOpen) {
        return NextResponse.json({ error: 'Message window closed. Use a template message instead.' }, { status: 400 })
      }
    }

    // 9. Normalize contact phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
    }

    // 10. Fetch WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', authResult.userId)
      .single()

    if (configError || !config) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })
    }

    // 12. Decrypt token
    const accessToken = decrypt(config.access_token)

    if (isLegacyFormat(config.access_token)) {
      void supabase.from('whatsapp_config').update({ access_token: encrypt(accessToken) }).eq('id', config.id).then()
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    // Reply context check
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const { data: parent } = await supabase
        .from('messages')
        .select('message_id')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', id)
        .maybeSingle()
      
      if (parent && parent.message_id) {
        contextMessageId = parent.message_id
      }
    }

    // 13. Template check
    let templateRow: any = null
    if (message_type === 'template') {
      const { data: tmpl } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', authResult.userId)
        .eq('name', template_name)
        .eq('language', template_language || 'en_US')
        .maybeSingle()
      
      if (!tmpl || tmpl.status?.toLowerCase() !== 'approved') {
        return NextResponse.json({ error: `Template "${template_name}" not found or not approved` }, { status: 400 })
      }
      
      if (!isMessageTemplate(tmpl)) {
        return NextResponse.json({ error: 'Template row is malformed' }, { status: 500 })
      }
      templateRow = tmpl
    }

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: template_name,
          language: template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams: template_message_params ?? undefined,
          params: template_params || [],
          contextMessageId,
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: content_text,
        contextMessageId,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 502 })
    }

    if (workingPhone !== sanitizedPhone) {
      await supabase.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
    }

    // 16. Insert message
    const { data: messageRecord, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        sender_type: 'agent',
        content_type: message_type,
        content_text: content_text || null,
        template_name: template_name || null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
      })
      .select('id, created_at')
      .single()

    if (msgError) {
      return NextResponse.json({ error: 'Failed to save message to DB' }, { status: 500 })
    }

    // 17. Update conversation
    await supabase
      .from('conversations')
      .update({
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 0
      })
      .eq('id', id)

    // 18. Pause flows
    try {
      await supabase
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('user_id', authResult.userId)
        .eq('contact_id', contact.id)
        .eq('status', 'active')
    } catch (err) {
      console.warn('[agent/messages] Pause flow failed:', err)
    }

    // 19. Log to agent_audit_log
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    await supabase.from('agent_audit_log').insert({
      api_key_id: authResult.apiKeyId,
      user_id: authResult.userId,
      action: 'send_message',
      resource_type: 'conversation',
      resource_id: id,
      request_method: 'POST',
      request_path: new URL(request.url).pathname,
      request_body: body,
      response_status: 200,
      ip_address: ip
    }).then(({ error }) => { if (error) console.warn('[agent/messages] audit log failed:', error) })

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
      sent_at: messageRecord.created_at
    })

  } catch (err) {
    console.error('[agent/messages] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
