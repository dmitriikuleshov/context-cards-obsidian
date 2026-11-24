import type { Settings } from './types';

type ErrorContext = 'model' | 'anki' | 'validation';
type ErrorSettings = Pick<Settings, 'provider' | 'ankiUrl' | 'ollamaUrl'>;

/** Scroll only this panel's containers, leaving the source document untouched. */
export function scrollPanelToTop(root: HTMLElement, content: HTMLElement = root) {
  content.scrollTop = 0;
  root.scrollTop = 0;
  // The standalone panel and some host layouts put scrolling on the wrapper.
  if (root.parentElement) root.parentElement.scrollTop = 0;
}

/** Presentation only: retain the original failure for troubleshooting and retries. */
export function describeError(
  raw: string,
  settings: ErrorSettings,
  context: ErrorContext = 'model',
) {
  const mentionsHost = (address: string) => {
    try {
      return raw.includes(new URL(address).host);
    } catch {
      return false;
    }
  };
  const anki =
    /\banki(?:connect)?\b/i.test(raw) || mentionsHost(settings.ankiUrl) || context === 'anki';
  const ollama = /\bollama\b/i.test(raw) || mentionsHost(settings.ollamaUrl);
  const service = anki
    ? 'AnkiConnect'
    : ollama || settings.provider !== 'chatgpt'
      ? 'Ollama'
      : 'ChatGPT';
  let title = 'Could not complete this step';
  let message = raw;
  if (/cancelled/i.test(raw)) {
    title = 'Cancelled';
  } else if (context === 'validation') {
    title = 'Check this card';
  } else if (
    /cannot connect|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|network error/i.test(raw)
  ) {
    title = `Cannot connect to ${service}`;
    message = anki
      ? 'Open the Anki desktop app and keep it running. Make sure the AnkiConnect add-on is installed and enabled, then try again. Check the Anki server address in Context Cards settings if it still fails.'
      : service === 'Ollama'
        ? 'Start Ollama and try again. If Ollama runs on another computer, check its server address in Context Cards settings and make sure this computer can reach it.'
        : 'Check your internet connection and try again. If it still fails, check the ChatGPT connection in Context Cards settings.';
  } else if (/timed out|timeout/i.test(raw)) {
    title = `${service} did not respond in time`;
    message = anki
      ? 'Make sure Anki is open and responsive, then try again.'
      : 'Try again. For a slow local model, increase Request timeout in Context Cards settings or choose a smaller model.';
    if (service === 'ChatGPT')
      message =
        'Check your internet connection and try again. You can also increase Request timeout in Context Cards settings.';
  } else if (/invalid JSON|invalid.*response|validate.*response|incomplete.*response/i.test(raw)) {
    title = anki
      ? 'AnkiConnect returned an unexpected response'
      : 'The model response could not be used';
    message = anki
      ? 'Check that the Anki server address points to AnkiConnect and that the add-on is up to date, then try again.'
      : 'Try generating again. If this keeps happening, choose another model in Context Cards settings. Your draft is still available.';
  } else if (/model.*not found|model.*does not exist/i.test(raw)) {
    title = 'The selected model is not available';
    message =
      'Choose an installed model in Context Cards settings. For Ollama, download the model first, then refresh the model list.';
  } else if (/Server returned \d+|HTTP \d+/i.test(raw)) {
    title = `${service} could not complete the request`;
    message = anki
      ? 'Check that Anki is open and the Anki server address points to AnkiConnect. See Technical details for the server response, then try again.'
      : 'Try again. If this keeps happening, check the selected model and provider connection in Context Cards settings. See Technical details for the server response.';
  }
  return { title, message, detail: message === raw ? '' : raw };
}

/** Shared alert surface for both modes, including editable-card validation. */
export function renderErrorFeedback(
  root: HTMLElement,
  raw: string,
  settings: ErrorSettings,
  context: ErrorContext = 'model',
) {
  root.replaceChildren();
  root.classList.add('cc-error-feedback');
  root.setAttribute('role', 'alert');
  const { title, message, detail } = describeError(raw, settings, context);
  root.createEl('strong', { cls: 'cc-error-title', text: title });
  root.createEl('p', { cls: 'cc-error-message', text: message });
  if (detail) {
    const technical = root.createEl('details', { cls: 'cc-error-details' });
    technical.createEl('summary', { text: 'Technical details' });
    technical.createEl('p', { text: detail });
  }
  return root;
}
