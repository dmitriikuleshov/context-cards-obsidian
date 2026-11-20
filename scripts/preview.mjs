// Standalone browser harness. Simulates connections; never contacts Ollama or Anki.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const bundle = await build({
  entryPoints: ['tests/ui/harness.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  alias: { obsidian: fileURLToPath(new URL('../tests/obsidian-mock.ts', import.meta.url)) },
});
const css = await readFile('styles.css', 'utf8');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Context Cards · development preview</title>
<link rel="stylesheet" href="/styles.css"><style>
:root{--background-primary:#faf9f6;--background-secondary:#f0efe9;--background-primary-alt:#f3f2ec;--background-modifier-border:#dedfd5;--text-normal:#2d352e;--text-muted:#788071;--text-faint:#90998c;--text-error:#ba5544;--text-warning:#ad7b37;--font-interface:system-ui,sans-serif;--font-text:Georgia,serif;color:var(--text-normal);background:var(--background-primary);font:14px var(--font-interface)}
*{box-sizing:border-box}body{margin:0}button,select,input,textarea{font:inherit;color:inherit}button,select{border:1px solid #d9ddd1;border-radius:6px;background:#faf9f6;padding:7px 10px;cursor:pointer}button:disabled{cursor:default;opacity:.5}input,textarea{border:1px solid #d9ddd1;border-radius:6px}select{height:36px}button:hover{background:#e9ecdf}summary{cursor:pointer}h1{font:40px Georgia,serif}.shell{display:grid;grid-template-columns:minmax(0,1fr) 410px;height:100vh}.book{padding:8vh max(30px,9vw);overflow:auto}.book p{font:21px/1.9 Georgia,serif;max-width:650px}.book small{font-size:11px;color:#89917f;letter-spacing:.1em;text-transform:uppercase}.book mark{background:#e3ead6;padding:2px}.notice{margin-top:40px;font:12px/1.7 system-ui,sans-serif;color:#7c8574;max-width:400px}#panel{overflow:auto;border-left:1px solid #dedfd5;background:#f4f3ee}a{color:inherit}@media(max-width:800px){.shell{display:block;height:auto}.book{display:none}#panel{width:100%;height:100vh;border:0}}
</style></head><body><main class="shell"><article class="book"><small>A book in your vault</small><h1>The Last Train</h1><p>Mara <mark>brushed off</mark> the first warning. By the time she reached the station, the last train had already left. She wished she had listened.</p><div class="notice">Development preview · Simulated connections.<br>The sidebar uses the actual plugin view and stylesheet.<br>Buttons in this preview do not create Anki notes.</div></article><aside id="panel"></aside></main><script src="/harness.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === '/harness.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === '/styles.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(css);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  }
});
const port = Number(process.env.CONTEXT_CARDS_PREVIEW_PORT ?? 4178);
server.listen(port, '127.0.0.1', () =>
  console.log(`Development preview: http://127.0.0.1:${port} (simulated connections)`),
);
