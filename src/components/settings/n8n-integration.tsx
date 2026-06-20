'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Copy, Key, Trash2, Webhook, CheckCircle2, Zap } from 'lucide-react';

interface ApiKey {
  id: string;
  label: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export function N8nIntegrationPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/settings/api-keys');
      if (res.ok) {
        const json = await res.json();
        setKeys(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys', err);
    } finally {
      setLoading(false);
    }
  };

  const generateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setGenerating(true);
    setNewRawKey(null);

    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel })
      });

      if (res.ok) {
        const json = await res.json();
        setNewRawKey(json.data.rawKey);
        setNewLabel('');
        fetchKeys();
      }
    } catch (err) {
      console.error('Failed to generate key', err);
    } finally {
      setGenerating(false);
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? Any integrations using it will immediately stop working.')) return;
    
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchKeys();
      }
    } catch (err) {
      console.error('Failed to delete key', err);
    }
  };

  const copyToClipboard = (text: string, isKey = false) => {
    navigator.clipboard.writeText(text);
    if (isKey) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2 text-indigo-400 mb-2">
            <Zap className="size-5" />
            <span className="font-semibold tracking-wide uppercase text-xs">n8n / Automations</span>
          </div>
          <CardTitle className="text-white">API Keys</CardTitle>
          <CardDescription className="text-slate-400">
            Generate an API key to securely connect this CRM with external automation tools like n8n or Zapier.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {newRawKey && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="size-5" />
                <h4 className="font-medium">New API Key Generated</h4>
              </div>
              <p className="text-sm text-emerald-200/70">
                Copy this key now. For security reasons, you will <strong>never see it again</strong>.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 bg-black/40 px-3 py-2 rounded font-mono text-emerald-300 break-all">
                  {newRawKey}
                </code>
                <Button 
                  onClick={() => copyToClipboard(newRawKey, true)}
                  variant="secondary" 
                  className="bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/50"
                >
                  {copiedKey ? 'Copied!' : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={generateKey} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="keyLabel" className="text-slate-300">New Key Label</Label>
              <Input 
                id="keyLabel" 
                placeholder="e.g. n8n Production" 
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="bg-slate-950 border-slate-700 text-white"
                maxLength={50}
              />
            </div>
            <Button type="submit" disabled={generating || !newLabel.trim()}>
              <Key className="size-4 mr-2" />
              Generate Key
            </Button>
          </form>

          {loading ? (
            <div className="text-sm text-slate-500 py-4">Loading keys...</div>
          ) : keys.length > 0 ? (
            <div className="border border-slate-800 rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-950">
                  <TableRow className="border-slate-800 hover:bg-slate-950">
                    <TableHead className="text-slate-400">Label</TableHead>
                    <TableHead className="text-slate-400">Created</TableHead>
                    <TableHead className="text-slate-400">Last Used</TableHead>
                    <TableHead className="text-right text-slate-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id} className="border-slate-800 hover:bg-slate-800/50">
                      <TableCell className="font-medium text-slate-200">{key.label}</TableCell>
                      <TableCell className="text-slate-400 text-sm">
                        {new Date(key.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-slate-400 text-sm">
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => deleteKey(key.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-4 text-center border border-slate-800 border-dashed rounded-lg bg-slate-900/50">
              No API keys generated yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2 text-indigo-400 mb-2">
            <Webhook className="size-5" />
            <span className="font-semibold tracking-wide uppercase text-xs">Integration Guide</span>
          </div>
          <CardTitle className="text-white">Connecting to n8n</CardTitle>
          <CardDescription className="text-slate-400">
            How to configure your automated AI workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-slate-300 text-sm leading-relaxed">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-white">1. Receiving Messages (Inbound)</h3>
            <p>
              To trigger an n8n workflow when a customer messages you, go to the <strong>Automations</strong> tab and create a new automation.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2 text-slate-400">
              <li>Set the Trigger to <strong>New Message Received</strong>.</li>
              <li>Add a Step: <strong>Send Webhook</strong>.</li>
              <li>Paste your n8n Webhook URL into the URL field.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-semibold text-white">2. Sending Replies via AI (Outbound)</h3>
            <p>
              To have your n8n AI agent automatically send a reply back to the CRM, add an <strong>HTTP Request</strong> node at the end of your workflow:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 mt-2 font-mono text-xs overflow-x-auto space-y-2">
              <div className="flex gap-4">
                <span className="text-slate-500">Method:</span>
                <span className="text-indigo-400 font-semibold">POST</span>
              </div>
              <div className="flex gap-4">
                <span className="text-slate-500">URL:</span>
                <span className="text-green-400">https://your-domain.com/api/agent/messages/send</span>
              </div>
              <div className="flex gap-4 items-start">
                <span className="text-slate-500">Headers:</span>
                <span className="text-amber-200">
                  Authorization: Bearer &lt;Your-API-Key&gt;<br/>
                  Content-Type: application/json
                </span>
              </div>
              <div className="flex gap-4 items-start pt-2">
                <span className="text-slate-500">Body:</span>
                <span className="text-slate-300">
{`{
  "to": "+1234567890",
  "message_type": "text",
  "content_text": "Your AI generated reply goes here"
}`}
                </span>
              </div>
            </div>
            <p className="text-slate-400 mt-2">
              This endpoint will automatically find or create the contact, place the message in their active conversation, and dispatch it via WhatsApp.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
