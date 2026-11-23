type CallbackPage = 'received' | 'declined' | 'invalid' | 'already-received' | 'not-found';

const messages: Record<CallbackPage, { status: string; title: string; message: string }> = {
  received: {
    status: 'Authorization received',
    title: 'Return to Obsidian',
    message:
      'Context Cards is finishing your ChatGPT connection. Open the plugin settings in Obsidian to check the connection status.',
  },
  declined: {
    status: 'Sign-in not completed',
    title: 'You can try again in Obsidian',
    message:
      'ChatGPT sign-in was cancelled or permission was declined. Return to Context Cards settings and choose Continue with ChatGPT to try again.',
  },
  invalid: {
    status: 'Sign-in response not accepted',
    title: 'Start again from Obsidian',
    message:
      'This response could not be matched to a valid sign-in request. Return to Context Cards settings and start sign-in again.',
  },
  'already-received': {
    status: 'Authorization already received',
    title: 'Check the connection in Obsidian',
    message:
      'This sign-in response has already been received. Return to Context Cards settings to check the connection status.',
  },
  'not-found': {
    status: 'Page not found',
    title: 'Return to Obsidian',
    message: 'Open Context Cards settings in Obsidian to start or check your ChatGPT connection.',
  },
};

/** Self-contained: no remote assets and no authorization parameters in the page. */
export function callbackPage(kind: CallbackPage): string {
  const { status, title, message } = messages[kind];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${title} · Context Cards</title>
<style>
:root{color-scheme:dark;--page:#1e1f1d;--surface:#272925;--text:#f0f1ea;--muted:#b9c0b0;--border:#41483b;--accent:#c4d8a5;--badge:#333e2b}
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:32px 20px;background:var(--page);color:var(--text);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:560px;padding:40px;border:1px solid var(--border);border-radius:20px;background:var(--surface)}
.brand{margin:0 0 32px;color:var(--muted);font-size:14px;font-weight:600;letter-spacing:.02em}.status{display:inline-block;margin:0 0 16px;padding:5px 12px;border-radius:20px;background:var(--badge);color:var(--accent);font-size:13px;font-weight:600}
h1{margin:0 0 16px;font-size:clamp(26px,6vw,34px);line-height:1.2;letter-spacing:-.025em}p{margin:0;overflow-wrap:anywhere}.message{color:var(--text)}.next{margin-top:24px;padding-top:24px;border-top:1px solid var(--border);color:var(--muted);font-size:14px}
@media(prefers-color-scheme:light){:root{color-scheme:light;--page:#f4f5ef;--surface:#fff;--text:#253021;--muted:#53634c;--border:#d9dfd3;--accent:#365120;--badge:#eaf0e2}}
@media(max-width:420px){main{padding:28px 24px}.brand{margin-bottom:24px}}
</style></head><body><main aria-labelledby="title">
<p class="brand">Context Cards · ChatGPT</p>
<p class="status">${status}</p>
<h1 id="title">${title}</h1>
<p class="message">${message}</p>
<p class="next">You can close this tab. It does not need to stay open while you use Context Cards.</p>
</main></body></html>`;
}
