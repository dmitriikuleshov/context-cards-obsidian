# Automated checks

Run commands from the repository root with **Node.js 22+** and npm. Start with `npm ci`. See [Development](DEVELOPMENT.md) for Windows/WSL commands and the safe test-vault workflow. All three coverage suites plus `npm run check` run in both GitHub workflows; browser and temporary-Anki checks are separate local checks.

## Browser and Anki prerequisites

```sh
npx playwright install --with-deps chromium
npm run test:ui
```

The browser suite runs the production panels against simulated services; it does not sign into ChatGPT, contact Ollama or export to real Anki. Screenshots/layout checks cover narrow panels, controls and callback pages in both themes. For template/backend checks, install [uv](https://docs.astral.sh/uv/) and run `npm run test:anki` and `npm run test:writing-anki`. These scripts fetch the Python Anki package into an isolated environment and use temporary collections, not your installed collection.

Panel regressions cover closing dropdowns with a second click, switching menus and cleaning up listeners after redraw, stable writing-footer geometry during analysis/preparation/export, shared error styling in light/dark themes, expandable troubleshooting details and safe rendering of server/model text. Error-description unit tests distinguish AnkiConnect, Ollama and ChatGPT, including custom Anki addresses. These are simulated UI checks, not live service availability checks.

For docs-only edits, check Markdown links/anchors, documented paths/npm commands, English text and `git diff --check`; application tests are not required when no runtime/build configuration changed.

## Vocabulary mode

```sh
npm ci
npm run test:vocabulary
```

The vocabulary coverage target includes eleven complete production modules: `main.ts` (plugin lifecycle, capture, commands and draft controller), `ollama.ts`, `capture.ts`, `text.ts`, `storage.ts`, `fields.ts`, `templates.ts`, `pronunciation.ts`, `source-mark.ts`, `anki.ts`, and `http.ts`. Coverage includes whole files without ignored lines. The percentage describes this core, not every plugin file: the review view, settings UI and shared dropdown are checked separately by unit/browser tests and are outside this percentage.

Each measured file must cover at least **98% of statements and lines, 97% of branches, and 100% of functions**. Falling below any threshold fails the command. HTML and machine-readable reports are generated at `coverage/vocabulary/index.html` and `coverage/vocabulary/coverage-summary.json`. The Tests workflow publishes a `vocabulary-coverage` artifact; both Tests and Release enforce these thresholds.

These deterministic checks require no downloaded model, running Anki, vault or credentials. They cover:

- Malformed, truncated, oversized and incomplete model output; legacy and grouped examples; disabled fields; custom counts; contextual and general meanings; word formation; offline IPA and pronunciation selection.
- Reading Mode and editor selections, nested inline markup, repeated words, UTF-16 offsets, neighbouring text, HTML escaping, gap answers and optional backtick marking.
- Cancellation, late responses, edits during generation, pending replacements, immutable settings snapshots, the shared request deadline and stale callbacks after unload.
- Bounded draft history, damaged stored records, restoration, independent field settings, debounced/serialized saves and failed disk writes.
- AnkiConnect response contracts, literal duplicate searches, batching, safe model migration, retry keys, lost export responses, invalid note IDs, queued exports and preservation of edits.

Integration tests run the actual controller, HTTP client, model parser and Anki adapter together against temporary local servers on OS-assigned ports. They verify that generation never exports without approval, that one note creates Recognition and Recall cards, and that retry recovery does not create another note. Source-marking tests use synthetic editors and mocked vault APIs. Nothing is written to the user's book or Anki collection.

Regressions found while adding coverage include losing direct text beside inline markup in Reading Mode, starting supplemental requests after the shared deadline, starting work after plugin unload, and accepting an invalid Anki note ID as a successful export. Each has a reproducing test.

Run the broader checks after vocabulary changes:

```sh
npm test -- --maxWorkers=2
npm run build
npm run test:ui
npm run test:anki
```

The browser suite uses simulated services. The Anki rendering/search check uses a temporary Python Anki collection, never the installed collection. Mocked model responses test software behavior, not the linguistic quality of a particular local model.

For a live vocabulary comparison, run `node scripts/audit-vocabulary-models.mjs` with Ollama and the required models installed; optional positional arguments choose exact model tags and `AUDIT_DIR` selects an output folder. The audit runs models sequentially, unloads other loaded models to isolate VRAM, uses synthetic passages and never contacts Anki or writes vault settings. Keep recorded baseline/candidate inputs, settings, structural results and semantic ratings together. Recorded comparisons under `experiments/` are historical evidence, not a guarantee about every later model build or release.

The default vocabulary audit also includes eight literary passages transferred from the retired canvas benchmark. Historical results keep their original case sets; use a fresh `AUDIT_DIR` for the expanded suite, and supply the same `AUDIT_CASES_FILE` to baseline/candidate runs when comparing versions. `npm run benchmark -- <model-tag>` is a smaller smoke check and writes `.test-artifacts/plugin-benchmark.json`. Generated coverage reports stay in the ignored `coverage/` directory or CI artifacts rather than the committed evaluation archives.

## Writing analysis

The focused analysis suite measures nine modules: `writing.ts` (validation, alignment and recovery), `writing-model.ts` (generation and independent verification), `writing-diff.ts` and `writing-edit-relation.ts` (grounded local edits and linked grammatical changes), `writing-literals.ts` (explicit literal data), `writing-american.ts` (regional spelling policy), `writing-controller.ts` (session lifecycle, preparation and saving), `writing-workflow.ts` (source highlights), and `http.ts` (model transport). UI and Anki scheduling are outside this coverage percentage.

```sh
npm ci
npm run test:analysis
```

This runs deterministic unit tests and integration tests against temporary local HTTP servers. No installed Ollama model, running Anki, Obsidian vault or credentials are needed. Local servers use OS-assigned ports and are closed after each test. Saved reviews use an in-memory vault.

Coverage is enforced **for each covered module**, rather than averaged across the application: at least **98% of lines and statements, 97% of branches, and 100% of functions**. Missing the threshold fails the command. HTML and JSON reports are generated at `coverage/analysis/index.html` and `coverage/analysis/coverage-summary.json`. Reports are generated files, not checked into Git.

The **Tests** GitHub Actions workflow runs coverage and the complete unit/build checks for pushes to `main`/`master` and pull requests. Download its `analysis-coverage` artifact and open `index.html` to inspect covered branches. Release builds enforce the same analysis coverage thresholds.

The suite checks malformed and oversized responses, exact source/answer alignment, duplicate or missing review IDs, optional versus genuine corrections, category settings, shared timeout budgets, cancellation and late responses, partial generation failures, serialization of writes, failed persistence, and restoration of valid saved work. Integration cases run the controller through HTTP, response validation and both exercise formats, including a settings change during an active batch. They never export a note to a real Anki collection.

Review-save regressions include literal managed-end markers inside quoted text, CRLF files, repeated saves without whitespace growth, and preservation of appended human notes. If an owned review is missing its actual end marker, saving fails without overwriting it.

Run the deterministic checks after changes to writing analysis:

```sh
npm test -- --maxWorkers=2
npm run test:analysis
npm run build
npm run test:ui
npm run test:writing-anki
```

The Anki rendering check uses a temporary collection. Browser tests simulate the model and Anki; they never create notes in your real collection.

To check the actual local model, start Ollama with the configured model downloaded, then run:

```sh
npm run test:writing-model
```

This optional check runs the production analysis and exercise generation code on fourteen synthetic cases. It covers capitalization, acceptable verb complements and past-time expressions, collocations, adjacent errors in one sentence, spelling around a grammar target, deletions and repeated correct sentences. It also checks American spelling, migration from removed category/dialect preferences and default exercise types. It checks expected edits and validates generated correction/gap exercises. It never contacts Anki or changes a vault.

The default is `qwen3.5:9b-q4_K_M` at `http://127.0.0.1:11434`. Override `OLLAMA_MODEL` or `OLLAMA_URL` in your environment to compare another configuration. The JSON report is written to `.test-artifacts/writing-full-live-audit.json`, with timings, findings and prepared exercises. Timings for a complete case include its card generation; `analysisSeconds` measures proofreading separately.

The regression tests cover failure modes found during the writing audit: conflicting hidden targets, partial-word highlights, unrelated generated questions, mismatched gap answers, missing or malformed reviewer decisions, loss of valid work after cancellation or a failed recheck, damaged saved findings and draft eviction during export. Every selected sentence must be returned exactly once. Local edits are derived from the corrected prose, then independently reviewed with one verdict: required, optional or incorrect. Invalid responses trigger one bounded retry within the original timeout.

For a comparison of all four installed models, run `node scripts/audit-writing-basics.mjs`. It records synthetic cases, actual requests/responses and exact-edit scores. Set a fresh `AUDIT_DIR` for each code version; resuming an existing directory uses its frozen client. Gold corrections are used only by the scorer. The audit runs models sequentially and unloads other loaded models to isolate GPU memory. Set `AUDIT_CASES_FILE` to use a separate held-out case array and `AUDIT_CARDS=1` to validate both exercise formats for cases with `cards` not set to `false`.

For changes that only affect local postprocessing, `node scripts/replay-writing-audit.mjs <audit-folder> ...` runs the current production pipeline on recorded responses. It asserts that every outgoing JSON payload is identical to the original live request, including exercise generation. If a prompt, schema or input changes, replay fails and a fresh live audit is required. A small explicit American-spelling table can enforce the requested standard when a reviewer calls a regional spelling optional; it does not override a rejected replacement or rename quoted/code literals.

For a mixed cached/live comparison, set `AUDIT_CACHE_DIR` to one or more comma-separated prior audit directories. Only byte-identical serialized request payloads (model, messages, options and JSON schema) reuse a response; changed requests go to Ollama. Traces record `cacheSource`, and results count cached and live calls separately. Do not use cached runs for speed comparisons or reuse responses after changing model weights. Gold plans may contain predeclared `alternativeExpected` arrays; corpus errata and manually adjudicated alternatives must be recorded and applied equally to baseline and candidate results.

Passing these passages is a regression check, not a measure of overall linguistic accuracy. A local model can still miss errors or make a poor suggestion. Prepared cards remain editable and require the user's review before export. Existing drafts keep their saved results; use **Recheck selection** to analyse them with the updated checks.

## ChatGPT subscription connection

Run `npm run test:chatgpt` for the provider-specific suite and coverage gates. It uses generated signing keys, in-memory Secret storage and simulated HTTP responses. No test reads a real user's credentials, opens real sign-in or spends a subscription/API allowance. Browser tests also simulate the account. Opening the preview with `?chatgpt` shows the connection control; `?chatgpt&limit` simulates an exhausted allowance.

Coverage includes signed identity verification (issuer, audience, expiry, nonce and signature), PKCE, loopback callback validation/cancellation, persistent registrations, rotating refresh tokens, concurrent refreshes, multiple accounts, revoked permissions, terminal/transient failures, logout and streamed terminal events. It also checks migration from local-only settings, complete vocabulary generation, writing analysis/exercises, provider switching, model discovery, narrow layouts and the existing-draft replacement review.

Transport regressions cover successful SSE responses with a missing or incorrect `Content-Type`, byte-split prefixes and UTF-8, comments/BOM before events, large streams, incomplete responses and safe rejection of HTML/ordinary JSON. Stream detection inspects at most 4 KB before switching to incremental decoding; the existing 8 MB stream limit and terminal-completion requirement still apply. These tests reproduce an installed-plugin failure where a successful HTTP 200 SSE body was incorrectly passed to `JSON.parse` because its header was missing.

Credentials are kept through Obsidian Secret storage, outside `data.json`. The plugin requires Obsidian 1.11.5+ only for this optional connection; older versions can continue using Ollama. All direct inference uses the public Responses endpoint, `store: false` and `stream: true`. Unsupported subscription fields are omitted. It never borrows credentials from Codex or other apps, calls ChatGPT backend endpoints or switches to API-key billing.

The suite gates the new modules at 95% statements, 98% lines, 92% branches and 90% functions. Existing per-file vocabulary and analysis coverage thresholds remain unchanged. Both GitHub workflows run the subscription suite.

Manual acceptance still requires signing in to an eligible account through the installed plugin, granting plan permission, selecting an account-visible model and successfully generating a draft. Public discovery being reachable and simulated OAuth tests passing do not establish access for a particular account. Test login, restart/refresh, cancel, reconnect, sign out and a return to Ollama without changing drafts. Account availability and model quality need separate live checks; automated tests do not claim those have happened.

The current runtime includes a transport fix checked by generating a vocabulary draft from a public book passage in Windows Obsidian with an already connected account. No Anki note was exported. This confirms that account/request path; it is not a complete real-account sign-in/refresh/revocation audit, a cross-platform result or a language-quality benchmark. Callback appearance is verified through real local HTTP tests and browser rendering without repeating real account authorization.

Regenerate existing guide images with `node scripts/capture-doc-screenshots.mjs` and `node scripts/capture-chatgpt-screenshot.mjs`. They use the production preview with simulated data and never authorize a real account. Update the existing images when UI changes; do not present them as live account screenshots.

The local callback page has separate received, declined, invalid, already-received and not-found states. Tests verify real loopback HTTP response headers and static HTML without echoing authorization parameters. `tests/ui/chatgpt-callback.spec.ts` renders the production page in light/dark themes at 360/1200 px, checks text contrast and layout, and saves preview images under `.test-artifacts`. These visual checks do not sign in or change an account. The received page deliberately asks the user to check Obsidian settings rather than claiming the token exchange already succeeded.

Security/stability regressions also cover stale credential errors after account switching or reauthorization, late success after cancellation, refresh results after unload, malformed token responses and safe Secret storage errors. Real loopback callback tests reject foreign hosts and malformed request targets, handle cancellation during listener startup and recover from bind failures. Generated RSA/EC keys exercise valid and tampered identity signatures; no real credentials are read.

`tests/chatgpt/network-integration.test.ts` exercises real Node HTTP sockets for split UTF-8, absent Content-Type, disconnects, cancellation, deadlines, socket cleanup, redirects and oversized bodies. Only the HTTPS request destination is replaced at the test boundary with a local HTTP server: these checks do not contact OpenAI or establish real TLS/account access. Additional stream tests reject malformed event fields, truncated UTF-8 and inherited error-code names while supporting LF, CRLF and CR framing. Coverage gates remain unchanged. Passing these checks is regression evidence, not an independent penetration test or proof against malicious software/plugins on the host.
