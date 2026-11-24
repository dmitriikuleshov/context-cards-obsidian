# Current work and handoff

Keep this file concise. Link a task document for multi-session implementation; do not copy the chat transcript or all test logs here. Read the current Git status and code before resuming.

## Released baseline

- Last published version: **0.3.41**, release commit **789bed2**.
- Runtime changes in that release: readable, self-contained ChatGPT callback pages for received, declined, invalid and repeated authorization responses.
- Live evidence: the earlier SSE fix was checked by generating a vocabulary draft in Windows Obsidian. The callback redesign was checked through real local HTTP tests and browser rendering, not a fresh real-account sign-in.
- See [testing](TESTING.md) for scope and remaining manual acceptance checks. This is a recorded baseline, not proof that every integration/platform is verified.

## Unreleased

- Development working agreements in root `AGENTS.md`, a Russian owner guide, and a release policy separating commits/local builds from publication.
- Documentation only: no runtime or version changes; no release requested for this work.
- Verification: 29 local Markdown links and documented npm script names checked; formatting and `git diff --check` passed. Application tests were not rerun because only documentation changed.

## Active implementation

None. The development-process documentation task is complete; user acceptance of the proposed process is still open to feedback.

## Next step

Use these agreements for the next requested task. Open the plugin repository as the Codex project, or explicitly ask the agent to read its `AGENTS.md` when continuing from a different working directory. Create a linked task plan only when a substantial implementation starts.
