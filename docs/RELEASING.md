# GitHub releases

Distribute manual Obsidian installations through GitHub Releases. Community-directory submission is a separate future step.

1. Keep versions in manifest.json, package.json and package-lock.json equal. Update documentation when behaviour changes.
2. Run npm run check, npm run package and npm run verify:package. Run relevant UI/Anki checks for changes affecting them.
3. Commit and push changes. Create and push a tag matching the version without a v prefix. For example:

   ```sh
   git tag 0.1.19
   git push origin 0.1.19
   ```

4. The Release workflow validates the tag, runs checks, builds/verifies the archive and creates a draft release with installable assets.
5. Review the draft in GitHub Releases and publish it. Only published releases are available at /releases/latest.

Manual workflow dispatch is supported on an existing version tag. Published releases are never replaced. Failed drafts can be retried; only that draft's assets are replaced.

Assets include the installable ZIP, individual plugin files, CMUdict notice and SHA256SUMS.txt. The ZIP has one context-cards/ folder. User settings, books, drafts, source experiments and reports are excluded.
