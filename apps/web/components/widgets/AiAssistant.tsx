'use client';

import { aiWidgetResponseSchema, type AiWidgetResponse, type WidgetConfig } from '@instafeed/shared';
import { useState } from 'react';
import { clientApi, errorMessage } from '../../lib/client';

/** Natural-language styling: suggestions are previewed and only applied to the unsaved draft on request. */
export function AiAssistant({ widgetId, config, onApply }: { widgetId: string; config: WidgetConfig; onApply: (c: WidgetConfig) => void }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiWidgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await clientApi(`/api/v1/widgets/${widgetId}/ai`, aiWidgetResponseSchema, { method: 'POST', body: JSON.stringify({ prompt, config }) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend>✨ AI assistant</legend>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} rows={3} style={{ width: '100%' }}
        placeholder="e.g. Make the cards rounder, use pink buttons that say “Buy now”, and hide prices on mobile" aria-label="Describe the change" />
      <button onClick={() => void ask()} disabled={busy || prompt.trim().length < 3}>{busy ? 'Thinking…' : 'Suggest changes'}</button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>{result.summary}</p>
          {result.changes.length === 0 ? <p><small>No changes suggested.</small></p> : (
            <>
              <ul>{result.changes.map((c) => <li key={c.path}><code>{c.path}</code>: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</li>)}</ul>
              <button onClick={() => { onApply(result.config); setResult(null); setPrompt(''); }}>Apply to draft (preview, then save)</button>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
