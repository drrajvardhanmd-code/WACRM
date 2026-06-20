import { NextResponse } from 'next/server'
import { authenticateAgent, requireScope } from '@/lib/agent/auth'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

export async function POST(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }

    if (!requireScope(authResult.scopes || [], 'messages:send')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const bodyText = await request.text()
    let body: any = {}
    try {
      body = JSON.parse(bodyText)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const {
      to,
      message_type,
      content_text,
      template_name,
      template_language,
      template_params,
      template_message_params,
    } = body

    if (!to) {
      return NextResponse.json({ error: 'Missing "to" parameter (phone number)' }, { status: 400 })
    }

    if (!message_type || (message_type === 'text' && !content_text) || (message_type === 'template' && !template_name)) {
      return NextResponse.json({ error: 'message_type and content_text/template_name are required' }, { status: 400 })
    }

    const supabase = supabaseAdmin()

    // 1. Sanitize Phone
    const sanitizedPhone = sanitizePhoneForMeta(to)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
    }

    // 2. Find or Create Contact
    let contactId: string
    const suffix = sanitizedPhone.length >= 8 ? sanitizedPhone.slice(-8) : sanitizedPhone
    const { data: potentialContacts } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('user_id', authResult.userId)
      .ilike('phone', `%${suffix}`)

    const matchedContact = potentialContacts?.find(c => c.phone && c.phone.replace(/\D/g, '') === sanitizedPhone.replace(/\D/g, ''))
    
    if (matchedContact) {
      contactId = matchedContact.id
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          user_id: authResult.userId,
          phone: sanitizedPhone,
          name: sanitizedPhone // default name to phone
        })
        .select('id')
        .single()

      if (contactError || !newContact) {
        return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
      }
      contactId = newContact.id
    }

    // 3. Find or Create Conversation
    let conversationId: string
    const { data: openConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', authResult.userId)
      .eq('contact_id', contactId)
      .in('status', ['open', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (openConv) {
      conversationId = openConv.id
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          user_id: authResult.userId,
          contact_id: contactId,
          status: 'open',
          unread_count: 0
        })
        .select('id')
        .single()

      if (convError || !newConv) {
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
      }
      conversationId = newConv.id
    }

    // 4. Fetch WhatsApp Config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', authResult.userId)
      .single()

    if (configError || !config) {
      return NextResponse.json({ error: 'WhatsApp not configured for this user' }, { status: 400 })
    }

    // 5. Check 24-hour window for text messages
    if (message_type === 'text') {
      const { data: lastCustMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
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

    // 6. Decrypt Token & Setup Meta Call
    const accessToken = decrypt(config.access_token)
    if (isLegacyFormat(config.access_token)) {
      void supabase.from('whatsapp_config').update({ access_token: encrypt(accessToken) }).eq('id', config.id).then()
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    // 7. Template handling
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
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: content_text,
      })
      return result.messageId
    }

    // 8. Execute Send
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
      await supabase.from('contacts').update({ phone: workingPhone }).eq('id', contactId)
    }

    // 9. Save Message to DB
    const { data: messageRecord, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'bot', // We use 'bot' or 'agent'
        content_type: message_type,
        content_text: content_text || null,
        template_name: template_name || null,
        message_id: waMessageId,
        status: 'sent',
      })
      .select('id, created_at')
      .single()

    if (msgError) {
      return NextResponse.json({ error: 'Failed to save message to DB' }, { status: 500 })
    }

    // 10. Update Conversation
    await supabase
      .from('conversations')
      .update({
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 0
      })
      .eq('id', conversationId)

    // 11. Pause flows (if AI responds, we stop automations)
    try {
      await supabase
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'bot_replied',
        })
        .eq('user_id', authResult.userId)
        .eq('contact_id', contactId)
        .eq('status', 'active')
    } catch (err) {
      console.warn('[agent/messages/send] Pause flow failed:', err)
    }

    // 12. Audit Log
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    await supabase.from('agent_audit_log').insert({
      api_key_id: authResult.apiKeyId,
      user_id: authResult.userId,
      action: 'direct_send_message',
      resource_type: 'conversation',
      resource_id: conversationId,
      request_method: 'POST',
      request_path: new URL(request.url).pathname,
      request_body: body,
      response_status: 200,
      ip_address: ip
    }).then(({ error }) => { if (error) console.warn('[agent/messages/send] audit log failed:', error) })

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
      conversation_id: conversationId,
      contact_id: contactId,
      sent_at: messageRecord.created_at
    })

  } catch (err) {
    console.error('[agent/messages/send] POST exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
