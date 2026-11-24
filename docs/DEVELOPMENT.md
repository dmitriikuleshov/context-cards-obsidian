# Development workflow

Context Cards is a desktop Obsidian plugin with Vocabulary and Find mistakes workflows, Ollama or ChatGPT generation, and approved Anki export. Keep the existing learning mechanics and user data stable while making focused changes.

## Existing documentation

- [README](../README.md): product overview and entry points.
- [Setup](SETUP.md): installation, AI providers, Anki and the interface walkthrough.
- [Testing](TESTING.md): commands, coverage boundaries and model evaluations.
- [Releasing](RELEASING.md): packaging and publication.
- [AGENTS.md](../AGENTS.md): repository instructions for coding agents.
- [Pronunciation data](../data/README.md): bundled dictionary provenance and license.

Keep repository documentation in English. Update these documents rather than adding translations, separate task journals or duplicated guides. Create additional documentation only when the user requests it. Preserve original third-party license notices.

## Define a task

A useful request describes the goal, reproduction/example, constraints and acceptance criteria. The owner does not need to guess the implementation.

```text
Goal: make usage headings readable in a narrow vocabulary panel.
Current behavior: the heading is clipped; see the screenshot.
Expected: text wraps, and the field remains editable.
Keep unchanged: generation, Anki export and other teaching fields.
Done when: checked at narrow/ordinary widths, with edits preserved
after switching between Edit and Preview.
Implement, verify and commit. Do not publish a release.
```

For bugs, include the version/commit, provider/model, steps, expected result and actual result. Use public or synthetic passages. Remove tokens, callback codes, private text and other credentials from shared screenshots/logs.

For a substantial feature, first establish the user journey, a simple interface and acceptance examples. If design approval was requested, show the prototype before changing production code. Small, clear fixes can proceed directly through implementation, checks and commit.

## Work in focused steps

1. Inspect the current code and reproduce the problem or document the missing evidence.
2. Define one observable outcome and the affected boundaries. Keep unrelated refactoring and upgrades out of the change.
3. Implement a small, complete step. Preserve user edits and compatibility with saved data.
4. Run appropriate checks and inspect the final diff. Review failure, cancellation and recovery paths.
5. Commit the logical change. Report the outcome, evidence, limitations, commit and any manual action needed.

Use one chat for a coherent task and its refinements. Start a separate chat for an unrelated substantial feature or a review of a defined diff. Open Codex in the actual repository root so it can load `AGENTS.md`; if working from another directory, explicitly ask it to read the repository instructions. See [instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

For an unfinished multi-session task, keep a short handoff at the end of this existing guide: goal, acceptance criteria, decisions, progress, checks, blockers and next step. Clear obsolete handoff details when the task finishes. The source code and Git history establish implementation state; a chat transcript is not a release record.

Use an isolated branch/worktree for a substantial feature or experiment. Two branches do not isolate two chats writing into the same checkout. One active writing task is enough for normal development; a separate read-only review can inspect the final commit/diff. Preserve unrelated edits and normally undo changes with a targeted revert commit.

## Environment and local builds

Requires **Node.js 22+** and npm. Run commands from the repository root:

```sh
npm ci
npm run build
npm run preview
```

The development preview uses the production views with simulated services at `http://127.0.0.1:4178`. It does not create Anki notes. `npm run dev` watches and rebuilds `main.js`. Build outputs, release packages and test artifacts are ignored by Git.

Use WSL to run Node/npm in the current Windows environment. Replace the placeholder below with the actual checkout path:

```powershell
wsl.exe --cd /mnt/c/path/to/context-cards --exec bash -lc 'npm run build'
```

Use a development vault. Installing into a real vault must be within the task's authorization: verify the exact destination, back up runtime files, copy only the release allowlist, preserve `data.json` and credentials, and record the installed commit plus any required reload. Never use the owner's Anki collection as an automated test fixture.

## Verification and model quality

Use [TESTING.md](TESTING.md) to select checks. Deterministic tests check software behavior; browser tests check controlled interactions/layout; actual Obsidian checks verify a specific host environment; real-provider evaluations assess particular model outputs. Report these as separate evidence. Coverage is not a language-quality score or a security audit.

Inspect UI changes at narrow and normal widths and in applicable empty, loading, expanded, error and editing states. For sensitive or substantial changes, make a separate review pass through the final diff. Label self-review accurately; it is not an independent audit.

Treat prompts, schemas, reasoning/decoding settings and validators as behavior changes:

- Identify the failing layer first. A transport error should be fixed in transport, rather than hidden by a prompt workaround.
- Retain a baseline commit, model identity and settings. Compare baseline/candidate on the same declared cases, including ordinary examples, known failures and held-out cases.
- Measure structural success, linguistic correctness, false corrections, regressions, latency and request count separately. Show actual numerators/denominators.
- Preserve unfavorable results and configuration without secrets. Correct gold expectations transparently for both versions; do not tune the scorer only for the candidate.
- Reuse cached responses only for byte-identical requests. Changed prompts need fresh inference; cached results do not establish live speed. Substantial cloud evaluations must be within the authorized allowance budget.

## Commits, installations and releases

Commit each completed logical change. A commit or pushed branch does not imply a new installable release. Keep the current manifest version during normal development and identify local builds by commit SHA.

Release publication requires a user request. Bump the version once for the checked batch, then follow [RELEASING.md](RELEASING.md). A request to commit, push or prepare a release is not a request to publish. Once publication is authorized, do not ask for the same permission again.

The repository distributes the latest supported release. Older source revisions remain in Git; old release assets are not the supported installation path. Do not rewrite published tags or replace tested runtime assets as a documentation edit.

## Keeping release notes

Update **Unreleased changes** below in the same logical commit as each user-visible feature, improvement or fix. This is the working list for the next release; published, versioned notes live in GitHub Releases. Keep everything in English and use short bullets describing what changed for the user, grouped under **Added**, **Improved** or **Fixed** when useful. Include compatibility requirements, required actions and known limitations when relevant. Internal refactoring, test-only work and routine documentation edits do not need a release-note entry unless they affect users.

Consolidate related entries, revise them as behavior changes, and remove entries for reverted work. Before releasing, compare the accumulated list with Git changes since the previous published tag so that omissions and abandoned changes do not reach the release description. Follow [Releasing](RELEASING.md) to transfer the checked list into the version's GitHub Release. After successful publication, remove only the published entries from this section; keep any later work marked unreleased. Recording changes does not authorize publication or a version bump. Do not create an additional changelog file.

## Unreleased changes

### Improved

- New errors in Vocabulary and Find mistakes automatically scroll the panel to the top. A failed retry also reveals the error again; ordinary redraws keep the user's reading position.
- Vocabulary uses larger, rounded **Edit draft** and **Preview cards** controls with icons, a clear selected state and keyboard focus retained when switching views.
- Both modes show consistent error panels with recovery steps and expandable technical details. Connection errors identify AnkiConnect, Ollama or ChatGPT.
- The source-note button has a compact icon and subtle hover styling.

### Fixed

- Retrying a failed vocabulary export keeps the last error, expanded troubleshooting details and footer layout in place while waiting for Anki, avoiding a brief editor jump. A successful export clears the error.
- The writing action bar keeps its layout during analysis and card preparation, with unavailable actions disabled.
- Dropdowns close when clicked again without changing the selected value.
- ChatGPT requests and refreshes stay bound to their original account session; cancelled or outdated responses cannot overwrite a newer session.
- ChatGPT handles malformed credentials, interrupted or invalid response streams, and connection cleanup more safely. Local sign-in callbacks reject malformed requests and recover safely from cancellation during startup.

## Current maintenance state

- Supported release: **0.3.41**, runtime tag commit **789bed2**.
- Latest maintenance: English documentation and release cleanup, followed by removal of obsolete design snapshots, early model probes and coverage snapshots. The vocabulary audit retains eight literary cases from the retired canvas benchmark; fresh smoke reports use ignored test artifacts. No runtime/version change.
- Unreleased runtime changes: ChatGPT session-bound request/error handling, cancellation/refresh guards, protected loopback callback startup and request parsing, strict stream/credential validation, and connection cleanup. These fixes require installing a development build or a future authorized release; the published 0.3.41 assets remain unchanged.
- Hardening verification: 940 full-suite tests, 175 ChatGPT tests (51 added), all coverage gates and 64 browser checks passed. Tests use generated credentials, simulated responses and real loopback sockets; real-account sign-in/refresh/revocation was not repeated, and no inference requests were made through the plugin's ChatGPT connection. See [Testing](TESTING.md) for boundaries.
- Unreleased panel maintenance: stable writing-footer layout while busy, a quiet source-note button, shared actionable errors with expandable technical details, and dropdown trigger toggling. Verification: 951 full-suite tests, 72 browser checks, build and package verification passed. Service failures are simulated; model prompts, export mechanics and stored data are unchanged.
- No active implementation handoff. Start the next task from the current branch, Git status and the relevant source files.
- Platform, account and live-test limitations are recorded in [Setup](SETUP.md) and [Testing](TESTING.md).
