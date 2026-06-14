import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function notifyNewMessage(params: {
  userId: string
  conversationId: string
  contactId: string
  contactName: string
  contactPhone: string
  messageText: string
  messageType: string
}): Promise<void> {
  const supabase = supabaseAdmin()
  await supabase.from('agent_notifications').insert({
    user_id: params.userId,
    notification_type: 'new_message',
    payload: {
      conversation_id: params.conversationId,
      contact_id: params.contactId,
      contact_name: params.contactName,
      contact_phone: params.contactPhone,
      message_text: params.messageText,
      message_type: params.messageType
    }
  }).catch(e => console.error('[notifyNewMessage] failed', e))
}

export async function notifyNewContact(params: {
  userId: string
  contactId: string
  contactName: string
  contactPhone: string
}): Promise<void> {
  const supabase = supabaseAdmin()
  await supabase.from('agent_notifications').insert({
    user_id: params.userId,
    notification_type: 'new_contact',
    payload: {
      contact_id: params.contactId,
      contact_name: params.contactName,
      contact_phone: params.contactPhone
    }
  }).catch(e => console.error('[notifyNewContact] failed', e))
}

export async function notifyDealUpdate(params: {
  userId: string
  dealId: string
  dealTitle: string
  oldStage: string
  newStage: string
}): Promise<void> {
  const supabase = supabaseAdmin()
  await supabase.from('agent_notifications').insert({
    user_id: params.userId,
    notification_type: 'deal_update',
    payload: {
      deal_id: params.dealId,
      deal_title: params.dealTitle,
      old_stage: params.oldStage,
      new_stage: params.newStage
    }
  }).catch(e => console.error('[notifyDealUpdate] failed', e))
}
