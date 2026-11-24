# GitHub releases

Distribute manual Obsidian installations through GitHub Releases. Community-directory submission is a separate future step.

## When to release

Commit each completed logical change. Routine development, a pushed branch and a local test installation do **not** require a version bump, tag or GitHub Release. Identify local builds by commit SHA while the manifest keeps the current release version. Use the existing [development guide](DEVELOPMENT.md) for any necessary handoff; do not create another release journal.

Start the steps below only when the user requests a release/publication, including an explicitly requested hotfix. A request to commit, push or prepare a release is not itself a request to publish. Once publication is authorized, complete verification and publication without asking for the same authorization again. Bump the version once for the accumulated release, rather than for each commit.

## Prepare and publish

1. Keep versions in manifest.json, package.json and package-lock.json equal. Update documentation when behaviour changes.
2. Run `npm run check`, all three coverage gates (`npm run test:analysis`, `npm run test:vocabulary`, `npm run test:chatgpt`), `npm run package` and `npm run verify:package`. Both GitHub workflows enforce all three coverage gates. Run relevant UI/Anki checks and document any unavailable live checks; use [TESTING.md](TESTING.md) for scope.
3. Commit and push changes. Create and push a tag matching the version without a v prefix. For example:

   ```sh
   git tag X.Y.Z
   git push origin X.Y.Z
   ```

4. The Release workflow validates the tag, runs checks, builds/verifies the archive and creates a draft release with installable assets.
5. Wait for the Tests and Release workflows to pass for the intended commit. Prepare English release notes from **Unreleased changes** in [Development](DEVELOPMENT.md), checked against Git since the previous published tag. Describe user-visible additions, improvements and fixes, including any compatibility requirements, required actions and known limitations. The workflow initially uses `docs/INSTALL.txt` as placeholder text: replace that draft description with the checked release notes and a link to the setup guide before publishing. A commit list or installation instructions alone are not release notes. Review asset contents/hashes, then publish the draft under the authorized release request. Only published releases are available at /releases/latest; BRAT users can receive the update. Do not publish with a known failing gate.
6. Verify the published version has its release notes and tested assets. Update the supported baseline in [Development](DEVELOPMENT.md) and remove only the entries included in that published version from **Unreleased changes**, preserving any later work. Commit this documentation update. Report the release URL, commit and any reload/manual action needed. Published tags and runtime assets remain immutable; publish a new version to correct runtime behavior.

## Supported release and cleanup

The supported installation is the latest published release, currently **0.3.41**. Use `/releases/latest` in user-facing links. Retain Git commits and tags for source history and rollback; they are not additional supported plugin downloads.

When cleanup is requested, first verify that the latest release has its complete, tested assets. Remove obsolete release records and drafts without deleting or moving tags. Verify `/releases` contains only the retained release and `/releases/latest` still resolves correctly. Release descriptions may be updated to link current English instructions, but do not silently replace published runtime files or their checksums.

Manual workflow dispatch is supported on an existing version tag. Published releases are never replaced. Failed drafts can be retried; only that draft's assets are replaced.

Assets include the installable ZIP, individual plugin files, CMUdict notice and SHA256SUMS.txt. The ZIP has one context-cards/ folder. User settings, books, drafts, source experiments and reports are excluded.
