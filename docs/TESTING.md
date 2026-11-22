# Writing analysis checks

Run the deterministic checks after changes to writing analysis:

```sh
npm test -- --maxWorkers=2
npm run build
npm run test:ui
npm run test:writing-anki
```

The Anki rendering check uses a temporary collection. Browser tests simulate the model and Anki; they never create notes in your real collection.

To check the actual local model, start Ollama with the configured model downloaded, then run:

```sh
npm run test:writing-model
```

This optional check runs the production analysis and exercise generation code on fourteen synthetic cases. It covers capitalization, acceptable verb complements and past-time expressions, collocations, adjacent errors in one sentence, spelling around a grammar target, deletions and repeated correct sentences. It also checks American/British preferences, disabled categories and default exercise types. It checks expected edits and validates generated correction/gap exercises. It never contacts Anki or changes a vault.

The default is `qwen3.5:9b-q4_K_M` at `http://127.0.0.1:11434`. Override `OLLAMA_MODEL` or `OLLAMA_URL` in your environment to compare another configuration. The JSON report is written to `.test-artifacts/writing-full-live-audit.json`, with timings, findings and prepared exercises. Timings for a complete case include its card generation; `analysisSeconds` measures proofreading separately.

The regression tests cover failure modes found during the writing audit: conflicting hidden targets, partial-word highlights, unrelated generated questions, mismatched gap answers, contradictory reviewer decisions, loss of valid work after cancellation or a failed recheck, damaged saved findings and draft eviction during export. Model proposals are checked again before the user reviews them; contradictory decisions trigger one bounded retry within the original timeout.

Passing these passages is a regression check, not a measure of overall linguistic accuracy. A local model can still miss errors or make a poor suggestion. Prepared cards remain editable and require the user's review before export. Existing drafts keep their saved results; use **Recheck selection** to analyse them with the updated checks.
