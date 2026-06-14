import { supabaseAdmin } from '../src/lib/flows/admin-client';

async function main() {
  const admin = supabaseAdmin();
  
  // 1. Get user_id
  const { data: profiles, error: pErr } = await admin.from('profiles').select('user_id').limit(1);
  if (pErr || !profiles || profiles.length === 0) {
    console.error('Could not fetch user_id', pErr);
    return;
  }
  const userId = profiles[0].user_id;
  console.log('Using userId:', userId);

  // 2. Create the Flow
  const flowName = "Harda Ads - Conversational Flow";
  const { data: flow, error: fErr } = await admin.from('flows').insert({
    user_id: userId,
    name: flowName,
    description: "Conversational flow for Click to WhatsApp Ads for Harda visits. No buttons, purely text and handoff.",
    status: "draft",
    trigger_type: "keyword",
    trigger_config: { keywords: ["hi", "hello", "harda", "नमस्ते", "namaste", "doctor"], match_type: "contains" },
    entry_node_id: "node_1_collect_illness"
  }).select().single();

  if (fErr || !flow) {
    console.error('Error creating flow:', fErr);
    return;
  }
  console.log('Created flow:', flow.id);

  // 3. Create the Nodes
  const nodes = [
    {
      flow_id: flow.id,
      node_key: "node_1_collect_illness",
      node_type: "collect_input",
      position_x: 100,
      position_y: 100,
      config: {
        prompt_text: "नमस्ते! डॉ. राजवर्धन जल्द ही हरदा आ रहे हैं। कृपया अपनी बीमारी या परेशानी यहाँ लिखकर बताएं, ताकि हम आपकी बेहतर मदद कर सकें।",
        var_key: "illness_description",
        next_node_key: "node_2_give_number"
      }
    },
    {
      flow_id: flow.id,
      node_key: "node_2_give_number",
      node_type: "send_message",
      position_x: 100,
      position_y: 300,
      config: {
        text: "जानकारी देने के लिए धन्यवाद। डॉक्टर साहब से हरदा में मिलने का समय बुक करने के लिए कृपया इस नंबर पर कॉल करें: 📞 +91 98765 43210\n\nआप चाहें तो अपना मोबाइल नंबर यहाँ भी लिख सकते हैं, हमारी क्लिनिक टीम आपको जल्द ही कॉल कर लेगी।",
        next_node_key: "node_3_handoff"
      }
    },
    {
      flow_id: flow.id,
      node_key: "node_3_handoff",
      node_type: "handoff",
      position_x: 100,
      position_y: 500,
      config: {
        note: "Patient from Harda Ads. Check illness_description var."
      }
    }
  ];

  const { error: nErr } = await admin.from('flow_nodes').insert(nodes);
  if (nErr) {
    console.error('Error creating nodes:', nErr);
  } else {
    console.log('Nodes created successfully!');
  }
}

main().catch(console.error);
