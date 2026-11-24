import { describe, expect, it } from 'vitest';
import { describeError } from '../src/error-feedback';
import { DEFAULTS } from '../src/types';

describe('actionable error feedback', () => {
  it('identifies the Anki server even when generation uses ChatGPT', () => {
    const raw = 'Cannot connect to 127.0.0.1:8765. Start the local server and try again.';
    const result = describeError(raw, { ...DEFAULTS, provider: 'chatgpt' });
    expect(result.title).toBe('Cannot connect to AnkiConnect');
    expect(result.message).toContain('Anki desktop');
    expect(result.message).toContain('AnkiConnect add-on');
    expect(result.detail).toBe(raw);
  });
  it('recognizes a custom Anki host without relying on the default port', () => {
    expect(
      describeError('Cannot connect to localhost:9900.', {
        ...DEFAULTS,
        ankiUrl: 'http://localhost:9900',
      }).title,
    ).toBe('Cannot connect to AnkiConnect');
  });
  it.each(['Cannot connect to 127.0.0.1:11434.', 'fetch failed', 'ENOTFOUND'])(
    'explains how to reconnect Ollama: %s',
    (raw) => {
      const result = describeError(raw, DEFAULTS);
      expect(result.title).toBe('Cannot connect to Ollama');
      expect(result.message).toContain('Start Ollama');
      expect(result.detail).toBe(raw);
    },
  );
  it('does not suggest a local server for a ChatGPT connection failure', () => {
    const result = describeError('Network error', { ...DEFAULTS, provider: 'chatgpt' });
    expect(result.title).toBe('Cannot connect to ChatGPT');
    expect(result.message).toContain('internet');
    expect(result.message).not.toContain('Start Ollama');
  });
  it.each(['model', 'anki'] as const)('offers relevant timeout recovery for %s', (context) => {
    const result = describeError('The request timed out after 60 seconds.', DEFAULTS, context);
    expect(result.title).toContain(context === 'anki' ? 'AnkiConnect' : 'Ollama');
    expect(result.message).toContain(context === 'anki' ? 'Anki is open' : 'Request timeout');
  });
  it('keeps model and Anki response failures distinct', () => {
    expect(describeError('Invalid response from AnkiConnect.', DEFAULTS).title).toContain(
      'AnkiConnect',
    );
    expect(describeError('ChatGPT returned invalid JSON. Try again.', DEFAULTS).message).toContain(
      'Try generating again',
    );
  });
  it('retains actionable validation, cancellation and unfamiliar errors verbatim', () => {
    for (const raw of [
      'Enter an explanation.',
      'Cancelled. Your previous results were kept.',
      '<img src=x onerror=alert(1)>',
    ]) {
      const result = describeError(raw, DEFAULTS, 'validation');
      expect(result.message).toBe(raw);
      expect(result.detail).toBe('');
    }
  });
  it('tolerates an invalid server setting and helps with missing models', () => {
    expect(describeError('model abc not found', { ...DEFAULTS, ankiUrl: ':' }).title).toBe(
      'The selected model is not available',
    );
  });
});
