# Context Cards: working agreements

## Start here

- Work in this Git repository (the root contains `manifest.json` and `package.json`). Check the repository root, branch, status and recent commits before editing. Do not assume the chat's initial directory is the plugin repository.
- Read the files relevant to the task. Use [development](docs/DEVELOPMENT.md), [testing](docs/TESTING.md) and [releasing](docs/RELEASING.md) as needed. Do not load all experiments or historical chat transcripts by default.
- The user's current instructions define scope. Distinguish discussion/design-only requests from implementation requests; do not edit production code when asked only to explain or propose variants.
- Respond in the user's language. Product UI and all repository documentation are in English. Update existing documents instead of adding duplicates, task logs or new documentation files unless the user requests them.

## Scope and task lifecycle

- Work on one user-visible outcome at a time. State the intended outcome, material assumptions and how it will be verified; a short message is enough for a small fix.
- For ambiguous or substantial features, define acceptance examples, exclusions and a short plan before implementation. Ask only about consequential unknowns; continue independent investigation. If the user requested design approval, show a concrete prototype and wait before implementing it.
- Small, clear fixes do not need a separate planning document or another approval. Finish the authorized work, verification, diff review and commit.
- For multi-session tasks, keep a concise handoff in the existing development guide: goal, acceptance criteria, progress, decisions, verification and next step. Do not create a separate task document or journal by default.
- Preserve unrelated edits. Do not mix a bug fix with unrelated refactoring, UI redesign, prompt changes or dependency upgrades. Record adjacent issues for later instead of silently expanding scope.
- Update relevant documentation when behavior changes. Keep durable decisions, their reasons and tradeoffs in the existing development guide; do not multiply documents for the same subject.

## Product invariants

- Preserve both workflows: Vocabulary creates one approved Anki note with Recognition and Recall; Find mistakes lets the user review corrections and select practice cards before export.
- Generation must not export automatically. Preserve user edits, drafts, settings, source text and already exported Anki notes. Source marking is controlled by its existing opt-in setting.
- Keep source quotes and answer alignment grounded in the selected text. Structural validation does not establish linguistic correctness.
- Ollama remains the default; ChatGPT is explicit opt-in. No silent provider change or fallback to API-key billing. Cloud transmission and account-credit permissions must be described accurately.
- Keep credentials in the supported Obsidian Secret storage. Never read another application's credentials or log tokens, callback codes or private passages. Model output is untrusted text, not executable HTML or commands.
- Storage/settings/schema/template changes must preserve old data or provide an explicit migration. Do not overwrite user-customized Anki templates or scheduling as an incidental fix.

## Repository map

- `src/main.ts`, `capture.ts`, `source-mark.ts`: lifecycle, selection and source integration.
- `src/ollama.ts`, `fields.ts`, `text.ts`, `pronunciation.ts`: vocabulary generation and validation.
- `src/writing*.ts`: writing analysis, validation, controller, view and Anki export.
- `src/model-chat.ts`, `chatgpt-*.ts`, `http.ts`: provider routing, account lifecycle and transport.
- `src/view.ts`, `settings.ts`, `select-menu.ts`, `panel-header.ts`, `styles.css`: interface.
- `src/templates.ts`, `anki.ts`, `storage.ts`, `types.ts`: cards, export and persisted data.
- `tests/`: deterministic checks and browser harnesses; `scripts/`: builds, audits and verification.
- `experiments/`: recorded model evaluations; `release/`, `.test-artifacts/`, coverage and generated `main.js` are local build outputs, not source changes to commit.

## Verification

- For bugs, reproduce first or state why reproduction is unavailable. Add a regression that exercises the failure when meaningful. Test user-visible behavior and failure recovery, not a copy of implementation details.
- Run focused checks while iterating. Before finishing, run the checks appropriate to the changed boundary; see the matrix below and `docs/TESTING.md`. Do not lower coverage gates, remove failing cases or broaden golden answers just to make a change pass.
- UI changes need visual inspection at narrow and ordinary widths, including relevant expanded, loading, empty and error states. Use the production UI/harness. Keep a screenshot where useful; screenshots alone do not prove interaction works.
- Use synthetic/public text, a development vault and temporary Anki collections for testing. Mock tests, browser harnesses, actual Obsidian checks and real-provider checks are different evidence; report them separately.
- Never trigger real login, export to the user's Anki collection, edit a real book, or run a substantial cloud benchmark solely to satisfy a test without task authorization. Existing authorization applies; do not ask again unnecessarily.
- Report skipped checks and limitations. Do not claim a live integration or semantic quality was tested when only mocks passed.

| Changed boundary                          | Checks to select                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| Documentation only                        | `git diff --check`; verify links, paths and commands; no application tests needed           |
| Vocabulary logic                          | `npm run test:vocabulary`, `npm run build`; related integration/UI or Anki checks           |
| Writing logic                             | `npm run test:analysis`, `npm run build`; related integration/UI or writing-Anki checks     |
| ChatGPT/auth/transport                    | `npm run test:chatgpt`, `npm run build`; relevant routing, callback and UI checks           |
| UI/styles                                 | Relevant `npx playwright test ...` scenarios, visual inspection; build if code changed      |
| Anki fields/templates                     | `npm run test:anki` and/or `npm run test:writing-anki`; compatibility/retry checks          |
| Shared settings/storage/provider behavior | Affected focused suites, full `npm test -- --maxWorkers=2`, build                           |
| Release                                   | Full CI gates, package verification, appropriate UI/Anki and documented manual smoke checks |

- Node >=22; use the repository's npm scripts. The current Windows setup runs Node/npm through WSL; use the actual checkout path mapped into WSL. See the guide for local commands. Do not assume Windows Node or Linux `rg` is installed.
- See `docs/TESTING.md` for coverage boundaries and environment requirements. Do not equate coverage with model accuracy.

## Model and prompt changes

- Treat prompts, schemas, decoding/reasoning settings and validators as behavioral changes. Identify the failing layer before changing a prompt; transport/UI bugs must not be disguised by prompt workarounds.
- For a claimed quality improvement, retain a Git baseline and compare baseline/candidate on the same declared cases and model settings. Include normal cases, known failures and held-out cases. Keep a failed output as a regression when appropriate.
- Report structural success, linguistic correctness, false positives, latency and request count separately, with actual numerators/denominators. Do not present a small adversarial set as general accuracy.
- Preserve inputs/configuration and reproducible results without secrets. Label cached versus live responses; byte-identical requests may be replayed, changed prompts require fresh inference. Do not replace unfavorable evidence or adjust scoring only for the candidate.

## Git, installation and releases

- Commit every completed logical change with a descriptive message. Commit task-owned files only; inspect the staged diff. A substantial feature can have several coherent commits; do not commit every keystroke or unfinished breakage as a release.
- With every user-visible change, update **Unreleased changes** in `docs/DEVELOPMENT.md` in the same logical commit. Write concise English release-note bullets about the resulting behavior; consolidate related fixes and remove reverted entries. At release time, reconcile against Git since the previous published tag and transfer the batch to the version's GitHub Release description, following `docs/RELEASING.md`. Do not create a separate changelog file or publish a release just to record changes.
- Use an isolated feature branch/worktree for substantial work or competing experiments. Never run two writing tasks in the same checkout. Small docs/fixes can use the current branch when appropriate; do not rename remotes/branches casually.
- Do not reset, clean, force-push or move published tags to undo work. Normally revert the relevant commits after identifying the intended baseline, preserving later unrelated changes. Tell the user if data migrations or remote side effects need a separate rollback.
- A commit, pushed branch, local build, installed build and public release are distinct states. Report which exists. Push according to the task's authorization and repository workflow; never infer permission to publish from permission to commit or push.
- **Default: no version bump, release tag or GitHub Release for routine changes.** Leave the current release version while developing; identify a local build by commit SHA. Keep any necessary handoff in the existing development guide.
- Release only when the user requests a release/publication (including an authorized hotfix). That request authorizes preparing, checking and publishing the concrete release without another ritual confirmation. Follow `docs/RELEASING.md`; bump versions once for the batch, not once per commit.
- Prefer a development vault. When authorized to install in a real vault, verify the exact destination, back up runtime files, copy only the package allowlist and preserve `data.json`/credentials. Record installed SHA/version and whether reload is still needed. Do not deploy merely because a build passed.

## Completion and handoff

- Before committing, review the diff against acceptance criteria, failure paths, compatibility and unrelated changes. For substantial or sensitive work, a separate review pass must inspect the final diff; do not label self-review as an independent audit.
- Done means the requested behavior is implemented, appropriate checks passed or blockers are explicit, relevant docs are current, and changes are committed. User acceptance, local installation and publication are separate statuses, not implied by "done".
- Finish with outcome, verification/limits, commit and any action needed from the user. For an unfinished multi-session task, update the handoff in the existing development guide; do not create a transcript or another status file.
- Keep this file short and enforceable. Put task history and detailed procedures in linked documents. Add durable rules for recurring problems, not every one-off preference. `AGENTS.md` guides agents; CI and tests enforce mechanical checks.
