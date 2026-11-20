# Context Cards

Turn selected words in Obsidian into editable English vocabulary cards using local Ollama and Anki.

[Download the latest release](https://github.com/dmitriikuleshov/context-cards-obsidian/releases/latest)

## Requirements

- Obsidian Desktop. Tested on Windows; actual app use on macOS/Linux is unverified. Mobile Obsidian is not supported.
- [Ollama](https://ollama.com/) and an installed model. Default: `qwen3.5:9b-q4_K_M`. Speed depends on hardware.
- Anki Desktop with [AnkiConnect](https://ankiweb.net/shared/info/2055492159). Keep Anki open when adding cards. Review synced cards normally on AnkiMobile/AnkiDroid.

## Install

1. Open [Releases](https://github.com/dmitriikuleshov/context-cards-obsidian/releases/latest). Under **Assets**, download **context-cards-VERSION.zip**. Automatic **Source code** archives do not contain the built plugin.
2. Extract the ZIP. Copy **context-cards** into your vault's **.obsidian/plugins/** folder; create `plugins` if needed. The result must be `.obsidian/plugins/context-cards/main.js`, without another nested folder.
3. Restart Obsidian. Enable community plugins if needed, then enable **Context Cards** under **Settings → Community plugins**. Installation is manual; the plugin is not in the Community directory yet.
4. Install/start Ollama and download the default model:

   ```sh
   ollama pull qwen3.5:9b-q4_K_M
   ```

   Another installed model can be selected in settings; structured output quality may vary.
5. Install AnkiConnect with Anki add-on code **2055492159**, then restart Anki.
6. In **Settings → Context Cards**, check both connections and the model name. Defaults: Ollama `http://127.0.0.1:11434`, AnkiConnect `http://127.0.0.1:8765`. Enter an API key if AnkiConnect requires one.

No Node.js, npm or Python is needed to install a release.

## Use and settings

Select a word/expression in a Markdown book in Reading Mode or Live Preview, click **Create cards**, edit the English draft, then **Add to Anki** in Edit.

- **Recognition:** word/expression with optional source-context hint; flip to see the explanation.
- **Recall:** source passage with a gap, optional definition hint and typed answer. Restore the original inflected source form.
- **Card fields:** toggle Grammar, word formation and context; choose American/British/off IPA; choose 1–10 sentences or off for contextual meaning, general meaning and explanation; choose up to 1–5 example groups and 1–10 examples per group.
- **Decks:** one Markdown file gets one subdeck under `English::Books` by default. Both sibling cards remain together.
- **Drafts:** only the last four are retained. **Clear all** removes drafts, not exported notes.
- **Source marking:** optionally wrap words in backticks in original Markdown. Off by default.
- **Reset to defaults:** resets connections and other settings; keeps drafts and Anki notes.

Disabling fields hides them without erasing current draft text. Regenerate and apply the new version to change counts or accent. Hiding context keeps the Recall gap; hiding contextual meaning removes its hint. Already exported notes are not regenerated.

Models can make mistakes. Review definitions, pronunciation and examples before approval. In Anki, consider **Bury siblings** to separate exercises.

## Update or uninstall

Disable the plugin. Download the new release and replace **main.js**, **manifest.json** and **styles.css** in the existing folder; update the included documentation and CMU notice too. **Keep your existing data.json**: it stores settings and drafts. Re-enable the plugin.

To uninstall, disable and remove the plugin folder. This removes local settings/drafts, but does not delete Anki notes or undo source markings.

## Troubleshooting

- Plugin missing: check ZIP choice and folder nesting, then restart Obsidian.
- Ollama unavailable: start it and check URL/model tag. Increase the timeout if initial model loading takes longer.
- Anki unavailable: open it, enable AnkiConnect and check URL/API key.
- Renamed Anki deck: **Refresh decks**, then select its new name. Existing destinations are not automatically remapped.

## Data and privacy

Selected text/context goes to the configured Ollama server; approved fields go to AnkiConnect. Both default to loopback addresses. There is no cloud fallback or telemetry. Changing server URLs changes where data is sent.

Settings, including any API key, and drafts are stored in the vault-local plugin **data.json**. Optional source marking edits original Markdown. Release archives exclude books, personal settings, drafts and experiment reports.

## Development

Node.js 22+:

```sh
npm ci
npm run check
npm run package
npm run verify:package
```

Archives are built in `release/`. UI checks: `npx playwright install --with-deps chromium`, then `npm run test:ui`. `npm run test:anki` checks templates in a temporary collection, not your personal collection.

See [release instructions](docs/RELEASING.md). [Historical notes](docs/DEVELOPMENT-HISTORY.ru.md) describe older versions, not the current installation process.

American pronunciation data is derived from CMUdict: see [data/README.md](data/README.md) and [its license](data/CMUDICT-LICENSE.txt). Its notice is included in releases.
