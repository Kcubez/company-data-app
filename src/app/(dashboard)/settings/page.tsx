'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Key,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type BotSettingsData = {
  botToken: string;
  geminiApiKey: string;
  geminiModel: string;
  isActive: boolean;
  updatedAt?: string;
};

function useBotSettings() {
  return useQuery({
    queryKey: ['bot-settings'],
    queryFn: async (): Promise<BotSettingsData> => {
      const res = await fetch('/api/settings/bot');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      return data.settings;
    },
  });
}

function useSaveBotSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { botToken: string; geminiApiKey: string }) => {
      const res = await fetch('/api/settings/bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to save' }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bot-settings'] });
      if (data.webhookRegistered) {
        toast.success('Bot saved & webhook registered!', {
          description: `Webhook: ${data.webhookUrl}`,
          duration: 5000,
        });
      } else {
        toast.success('Bot settings saved successfully');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save settings');
    },
  });
}

export default function SettingsPage() {
  const { data: settings, isLoading } = useBotSettings();
  const saveMutation = useSaveBotSettings();

  const [botTokenDraft, setBotTokenDraft] = useState<string | null>(null);
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const botToken = botTokenDraft ?? settings?.botToken ?? '';
  const geminiApiKey = geminiApiKeyDraft ?? settings?.geminiApiKey ?? '';
  const hasChanges = botTokenDraft !== null || geminiApiKeyDraft !== null;

  const handleSave = () => {
    saveMutation.mutate(
      { botToken, geminiApiKey },
      {
        onSuccess: () => {
          setBotTokenDraft(null);
          setGeminiApiKeyDraft(null);
        },
      }
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
          {settings?.isActive && (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Bot Connected
            </Badge>
          )}
          {settings && !settings.isActive && !isLoading && (
            <Badge className="bg-slate-800 text-slate-400 border-slate-700">
              <AlertCircle className="w-3 h-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>
        <p className="text-slate-400">Configure Telegram intake and Gemini AI parsing</p>
      </div>

      {/* Bot Token Card */}
      <Card className="bg-slate-900 border-slate-800 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10">
              <Bot className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-white text-lg">Telegram Bot Token</CardTitle>
              <CardDescription className="text-slate-400">
                Get your bot token from{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                >
                  @BotFather
                  <ExternalLink className="w-3 h-3" />
                </a>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">Bot Token</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {isLoading ? (
                <div className="h-10 bg-slate-800 rounded-md animate-pulse" />
              ) : (
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => {
                    setBotTokenDraft(e.target.value);
                  }}
                  placeholder="123456789:ABCdefGHIjklMNO..."
                  className="pl-9 pr-20 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-600 focus-visible:ring-indigo-500 font-mono text-sm"
                />
              )}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {botToken && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(botToken, 'Bot token')}
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Your bot token is stored securely and never exposed in the frontend
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-white text-lg">Gemini AI Parser</CardTitle>
              <CardDescription className="text-slate-400">
                Used to extract demand-sheet records with {settings?.geminiModel || 'gemini-2.5-flash'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Gemini API Key
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {isLoading ? (
                <div className="h-10 bg-slate-800 rounded-md animate-pulse" />
              ) : (
                <Input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => {
                    setGeminiApiKeyDraft(e.target.value);
                  }}
                  placeholder="AIza..."
                  className="pl-9 pr-20 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-600 focus-visible:ring-indigo-500 font-mono text-sm"
                />
              )}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {geminiApiKey && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(geminiApiKey, 'Gemini API key')}
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Telegram reports use Gemini first; if the API fails, the app falls back to local parsing.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-2 pb-8">
        <div>
          {hasChanges && (
            <p className="text-sm text-amber-400 flex items-center gap-1.5 animate-in fade-in duration-200">
              <AlertCircle className="w-3.5 h-3.5" />
              You have unsaved changes
            </p>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
