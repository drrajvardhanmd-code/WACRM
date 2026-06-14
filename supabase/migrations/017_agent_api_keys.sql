-- ============================================================
-- AGENT API KEYS
-- Stores hashed API keys for machine-to-machine authentication.
-- The plaintext key is only shown once at creation time.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["admin"]'::jsonb,
  rate_limit_requests INTEGER NOT NULL DEFAULT 120,
  rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Each key hash must be unique per user (no duplicate keys)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_api_keys_hash 
  ON agent_api_keys(user_id, key_hash);

-- Fast lookup by hash during auth
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash_lookup 
  ON agent_api_keys(key_hash) WHERE is_active = true;

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages agent keys" ON agent_api_keys;
CREATE POLICY "Service role manages agent keys" ON agent_api_keys
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- AGENT AUDIT LOG
-- Records every action performed through the agent API.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id UUID REFERENCES agent_api_keys(id),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_method TEXT,
  request_path TEXT,
  request_body JSONB,
  response_status INTEGER,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_user_time 
  ON agent_audit_log(user_id, created_at DESC);

ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages audit log" ON agent_audit_log;
CREATE POLICY "Service role manages audit log" ON agent_audit_log
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- AGENT NOTIFICATIONS
-- Queue of events the agent should process (new messages, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_pending 
  ON agent_notifications(user_id, created_at DESC) WHERE status = 'pending';

ALTER TABLE agent_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages notifications" ON agent_notifications;
CREATE POLICY "Service role manages notifications" ON agent_notifications
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- SEED DEFAULT AGENT KEY
-- Replace 'CHANGE_ME_TO_A_RANDOM_64_CHAR_HEX_STRING' with a real
-- key generated via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
-- The hash stored here is SHA-512 of the plaintext key.
-- Generate the hash via: node -e "const c=require('crypto');console.log(c.createHash('sha512').update('YOUR_PLAINTEXT_KEY').digest('hex'))"
-- ============================================================
INSERT INTO agent_api_keys (id, user_id, label, key_hash, scopes, is_active)
VALUES (
  uuid_generate_v4(),
  (SELECT id FROM auth.users LIMIT 1),
  'Hermes AI Agent',
  'bd1fe920ed4559c71635d778e4eaa369f1eed605440cfad29340a12d0f4320f7ece6855e39b255d63cc989083546ac2d53742f49226d02e5d7f3a1b8cdf24379',
  '["admin"]'::jsonb,
  true
);
