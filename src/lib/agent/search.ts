import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function searchConversations(userId: string, query: string) {
  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('messages')
    .select('id, conversation_id, content_text')
    .eq('user_id', userId)
    .ilike('content_text', `%${query}%`)
    .limit(50)
  return data
}
