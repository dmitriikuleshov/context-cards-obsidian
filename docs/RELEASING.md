# GitHub releases

Distribute manual Obsidian installations through GitHub Releases. Community-directory submission is a separate future step.

## When to release

Commit each completed logical change. Routine development, a pushed branch and a local test installation do **not** require a version bump, tag or GitHub Release. Collect unreleased changes in [WORK.md](WORK.md); identify local builds by commit SHA while the manifest keeps the current release version.

Start the steps below only when the user requests a release/publication, including an explicitly requested hotfix. A request to commit, push or prepare a release is not itself a request to publish. Once publication is authorized, complete verification and publication without asking for the same authorization again. Bump the version once for the accumulated release, rather than for each commit.

## Prepare and publish

1. Keep versions in manifest.json, package.json and package-lock.json equal. Update documentation when behaviour changes.
2. Run `npm run check`, the applicable coverage gates (`npm run test:analysis`, `npm run test:vocabulary`, `npm run test:chatgpt`), `npm run package` and `npm run verify:package`. Both GitHub workflows enforce all three coverage gates. Run relevant UI/Anki checks and document any unavailable live checks; use [TESTING.md](TESTING.md) for scope.
3. Commit and push changes. Create and push a tag matching the version without a v prefix. For example:

   ```sh
   git tag 0.1.19
   git push origin 0.1.19
   ```

4. The Release workflow validates the tag, runs checks, builds/verifies the archive and creates a draft release with installable assets.
5. Wait for the Tests and Release workflows to pass for the intended commit. Review release notes and asset contents/hashes, then publish the draft under the authorized release request. Only published releases are available at /releases/latest; BRAT users can receive the update. Do not publish with a known failing gate.
6. Update the released baseline and clear only the shipped entries in [WORK.md](WORK.md). Report the release URL, commit and any reload/manual action needed. Published tags and assets remain immutable; publish a new version to correct them.

Manual workflow dispatch is supported on an existing version tag. Published releases are never replaced. Failed drafts can be retried; only that draft's assets are replaced.

Assets include the installable ZIP, individual plugin files, CMUdict notice and SHA256SUMS.txt. The ZIP has one context-cards/ folder. User settings, books, drafts, source experiments and reports are excluded.
