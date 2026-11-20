import { PluginSettingTab, Setting, Notice, type App } from 'obsidian';
import type ContextCardsPlugin from './main';
import { DEFAULTS, cardFields, type CardFields, type Settings } from './types';
import { Ollama } from './ollama';
import { Anki } from './anki';
import { endpoint } from './http';

export class ContextSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: ContextCardsPlugin,
  ) {
    super(app, plugin);
  }
  display() {
    const root = this.containerEl;
    root.empty();
    root.createEl('h2', { text: 'Context Cards' });
    root.createEl('p', {
      text: 'Select a passage, review an English draft, and add two cards to Anki. Generation uses your configured local Ollama server.',
    });
    const settings = this.plugin.settings;
    const text = (
      name: string,
      description: string,
      key: keyof Settings,
      placeholder: string,
      password = false,
    ) => {
      new Setting(root)
        .setName(name)
        .setDesc(description)
        .addText((input) => {
          input.setPlaceholder(placeholder).setValue(String(settings[key]));
          if (password) input.inputEl.type = 'password';
          input.onChange((value) => {
            Object.assign(settings, { [key]: value });
            this.plugin.persist();
          });
        });
    };
    new Setting(root).setName('Local model').setHeading();
    text(
      'Ollama server',
      'The address of your local Ollama instance. No cloud fallback is used.',
      'ollamaUrl',
      DEFAULTS.ollamaUrl,
    );
    text('Model', 'Use an installed model tag.', 'model', DEFAULTS.model);
    new Setting(root)
      .setName('Check Ollama')
      .setDesc('Lists installed models without loading one into GPU memory.')
      .addButton((button) =>
        button.setButtonText('Check connection').onClick(async () => {
          button.setDisabled(true);
          try {
            endpoint(settings.ollamaUrl);
            const models = await new Ollama(settings).models();
            result.setText(
              models.length
                ? `Installed models: ${models.join(', ')}`
                : 'Connected. No models are installed.',
            );
          } catch (error) {
            result.setText(error instanceof Error ? error.message : String(error));
          } finally {
            button.setDisabled(false);
          }
        }),
      );
    const result = root.createDiv({ cls: 'cc-settings-result', attr: { role: 'status' } });
    new Setting(root)
      .setName('Context length')
      .setDesc(
        'Maximum surrounding characters sent with a selection. More context can be included from the draft editor.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            '1000': 'Short · 1,000 characters',
            '1800': 'Balanced · 1,800 characters',
            '3000': 'Expanded · 3,000 characters',
            '6000': 'Long · 6,000 characters',
          })
          .setValue(String(settings.contextSize))
          .onChange((value) => {
            settings.contextSize = Number(value);
            this.plugin.persist();
          }),
      );
    new Setting(root)
      .setName('Generation temperature')
      .setDesc(
        'The tested starting value is 0.2. The model runs without an unrestricted thinking phase.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ '0.1': '0.1', '0.2': '0.2 · recommended', '0.4': '0.4', '0.7': '0.7' })
          .setValue(String(settings.temperature))
          .onChange((value) => {
            settings.temperature = Number(value);
            this.plugin.persist();
          }),
      );
    new Setting(root)
      .setName('Request timeout')
      .setDesc('Includes the first model load. Typical warm generation should be much shorter.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ '30': '30 seconds', '60': '60 seconds', '120': '120 seconds' })
          .setValue(String(settings.timeoutSeconds))
          .onChange((value) => {
            settings.timeoutSeconds = Number(value);
            this.plugin.persist();
          }),
      );
    new Setting(root).setName('Card fields').setHeading();
    root.createEl('p', {
      cls: 'cc-muted',
      text: 'Changes apply to the editor, preview and future Anki exports. Regenerate a draft to apply new sentence counts or pronunciation. Existing Anki notes are unchanged.',
    });
    settings.fields = cardFields(settings);
    const changed = () => {
      this.plugin.persist();
      this.plugin.refresh();
    };
    const toggle = (label: string, key: 'grammar' | 'wordFormation' | 'context' | 'examples') => {
      new Setting(root).setName(label).addToggle((t) =>
        t.setValue(settings.fields[key]).onChange((v) => {
          settings.fields[key] = v;
          changed();
        }),
      );
    };
    const quantity = (
      label: string,
      key:
        | 'meaningSentences'
        | 'generalMeaningSentences'
        | 'explanationSentences'
        | 'maxUsages'
        | 'examplesPerUsage',
      off = false,
      max = 10,
    ) => {
      new Setting(root).setName(label).addDropdown((d) => {
        if (off) d.addOption('0', 'Off');
        for (let n = 1; n <= max; n++) d.addOption(String(n), String(n));
        d.setValue(String(settings.fields[key])).onChange((v) => {
          settings.fields[key] = Number(v);
          changed();
        });
      });
    };
    toggle('Grammar', 'grammar');
    new Setting(root).setName('IPA').addDropdown((d) =>
      d
        .addOptions({ american: 'American', british: 'British', off: 'Off' })
        .setValue(settings.fields.ipa)
        .onChange((v) => {
          settings.fields.ipa = v as CardFields['ipa'];
          changed();
        }),
    );
    quantity('Meaning in this context · sentences', 'meaningSentences', true);
    quantity('General meaning · sentences', 'generalMeaningSentences', true);
    toggle('Word formation', 'wordFormation');
    new Setting(root)
      .setName('Context from your book')
      .setDesc(
        'Show the source passage. The passage is always used for generation and the gap on the Recall card.',
      )
      .addToggle((t) =>
        t.setValue(settings.fields.context).onChange((v) => {
          settings.fields.context = v;
          changed();
        }),
      );
    quantity('Explanation · sentences', 'explanationSentences', true);
    toggle('Examples', 'examples');
    quantity('Examples · maximum meanings / usages', 'maxUsages', false, 5);
    quantity('Examples · examples per usage', 'examplesPerUsage');
    new Setting(root).setName('Anki').setHeading();
    text(
      'AnkiConnect server',
      'Keep desktop Anki open with the AnkiConnect add-on enabled.',
      'ankiUrl',
      DEFAULTS.ankiUrl,
    );
    text(
      'AnkiConnect API key',
      'Leave empty unless you configured a key in AnkiConnect. Stored in this vault’s plugin settings.',
      'ankiKey',
      'Optional',
      true,
    );
    text(
      'Default deck',
      'The parent deck for your books. Each book can remember its own destination.',
      'rootDeck',
      DEFAULTS.rootDeck,
    );
    new Setting(root)
      .setName('One deck per book')
      .setDesc(
        'For example: English::Books::Animal Farm. Recognition and Recall stay together in that deck.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.decksByBook).onChange((value) => {
          settings.decksByBook = value;
          this.plugin.persist();
        }),
      );
    text(
      'Note type',
      'A dedicated note type with Recognition and Recall templates. Created on the first approved export; existing templates are not overwritten.',
      'noteType',
      DEFAULTS.noteType,
    );
    text(
      'Default tags',
      'Applied to new notes. Separate tags with spaces.',
      'defaultTags',
      DEFAULTS.defaultTags,
    );
    new Setting(root)
      .setName('Check Anki')
      .setDesc('Reads deck names. No notes or decks are created.')
      .addButton((button) =>
        button.setButtonText('Check connection').onClick(async () => {
          button.setDisabled(true);
          try {
            const names = await new Anki(settings).decks();
            this.plugin.deckNames = names;
            ankiResult.setText(`Connected · ${names.length} deck${names.length === 1 ? '' : 's'}`);
          } catch (error) {
            ankiResult.setText(error instanceof Error ? error.message : String(error));
          } finally {
            button.setDisabled(false);
          }
        }),
      );
    const ankiResult = root.createDiv({ cls: 'cc-settings-result', attr: { role: 'status' } });
    root.createEl('p', {
      cls: 'cc-muted',
      text: 'In Anki, enable Bury siblings to separate the two exercises. Scheduling and FSRS remain controlled by Anki.',
    });
    new Setting(root).setName('Reading workflow').setHeading();
    new Setting(root)
      .setName('Selection button')
      .setDesc('Show Create cards beside a selection in Reading Mode and Live Preview.')
      .addToggle((toggle) =>
        toggle.setValue(settings.floatingButton).onChange((value) => {
          settings.floatingButton = value;
          this.plugin.persist();
        }),
      );
    new Setting(root)
      .setName('Mark selected word as inline code')
      .setDesc(
        'When creating cards, wrap the selected word in backticks in the source Markdown. Works in Live Preview and Reading Mode; existing code is left unchanged.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.markSourceWord).onChange((value) => {
          settings.markSourceWord = value;
          this.plugin.persist();
        }),
      );
    new Setting(root)
      .setName('Restore unfinished drafts')
      .setDesc(
        'Keeps drafts in plugin data so a restart or connection error does not lose your work. No Markdown notes are created.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.restoreDrafts).onChange((value) => {
          settings.restoreDrafts = value;
          this.plugin.persist();
        }),
      );
    new Setting(root).setName('Reset settings').setHeading();
    new Setting(root)
      .setName('Restore default settings')
      .setDesc(
        'Reset all plugin settings, including connections, card fields and remembered book decks. Drafts and existing Anki notes are kept.',
      )
      .addButton((button) =>
        button.setButtonText('Reset to defaults').onClick(() => {
          this.plugin.settings = structuredClone(DEFAULTS);
          this.plugin.persist();
          this.plugin.refresh();
          this.display();
          new Notice('Context Cards settings restored to defaults.');
        }),
      );
    root.createEl('p', {
      cls: 'cc-muted',
      text: 'Commands: Create cards from selection · Open review panel · Check connections. Assign shortcuts under Obsidian → Hotkeys.',
    });
  }
}
