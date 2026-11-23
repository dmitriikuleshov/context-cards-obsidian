import { PluginSettingTab, Setting, Notice, type App } from 'obsidian';
import type ContextCardsPlugin from './main';
import {
  DEFAULTS,
  cardFields,
  MAX_TIMEOUT_SECONDS,
  validTimeoutSeconds,
  type CardFields,
  type Settings,
} from './types';
import { Ollama } from './ollama';
import { Anki } from './anki';
import { endpoint } from './http';
import { enhanceSelects } from './select-menu';
import { ModelControl } from './model-control';

export class ContextSettings extends PluginSettingTab {
  private dropdownCleanup?: () => void;
  private modelControl?: ModelControl;
  constructor(
    app: App,
    private plugin: ContextCardsPlugin,
  ) {
    super(app, plugin);
  }
  display() {
    this.dropdownCleanup?.();
    this.modelControl?.destroy();
    const root = this.containerEl;
    root.empty();
    root.createEl('h2', { text: 'Context Cards' });
    root.createEl('p', {
      text: 'Select a word to create vocabulary cards, or select your own writing to review mistakes and create practice. Both modes use your configured Ollama server.',
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
            if (key === 'ollamaUrl') this.modelControl?.schedule();
          });
        });
    };
    new Setting(root).setName('Local model').setHeading();
    text(
      'Ollama server',
      'Where the model runs. Keep http://127.0.0.1:11434 when Ollama is on this computer, and leave Ollama running while generating. Change this only to use another server; selected text and context will be sent there.',
      'ollamaUrl',
      DEFAULTS.ollamaUrl,
    );
    const model = new Setting(root).setName('Model');
    this.modelControl = new ModelControl(
      model.controlEl,
      settings,
      () => this.plugin.persist(),
      (text) => model.setDesc(text),
      (snapshot, signal) => new Ollama({ ...settings, ...snapshot }).models(signal),
    );
    void this.modelControl.load();
    new Setting(root)
      .setName('Context length')
      .setDesc(
        'How much surrounding source text to include in a new draft. Start with Balanced. Increase it when the meaning needs more context; longer passages may take more time to process. You can also use More context in the editor.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            '1000': 'Short · 1,000 characters',
            '1800': 'Balanced · 1,800 characters',
            '3000': 'Expanded · 3,000 characters',
            '6000': 'Long · 6,000 characters',
            '12000': 'Extended · 12,000 characters',
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
        'Controls variation in generated wording. Start with 0.2 for consistent drafts. Higher values may produce more varied wording but less reliable definitions and examples; they do not make the model more knowledgeable.',
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
      .setDesc(
        'Maximum generation time in seconds, including the initial model load. Default: 60. Enter a longer duration for slower hardware, for example 300 or 600. A higher limit does not make generation faster.',
      )
      .addText((input) => {
        input.inputEl.type = 'number';
        input.inputEl.min = '1';
        input.inputEl.max = String(MAX_TIMEOUT_SECONDS);
        input.inputEl.step = '1';
        input.inputEl.setAttribute('aria-label', 'Request timeout in seconds');
        input.setPlaceholder('60').setValue(String(settings.timeoutSeconds));
        input.onChange((value) => {
          const seconds = Number(value);
          const valid = value.trim() !== '' && validTimeoutSeconds(seconds);
          input.inputEl.setCustomValidity(
            valid ? '' : `Enter a whole number from 1 to ${MAX_TIMEOUT_SECONDS} seconds.`,
          );
          input.inputEl.setAttribute('aria-invalid', String(!valid));
          if (!valid) return;
          settings.timeoutSeconds = seconds;
          this.plugin.persist();
        });
        input.inputEl.addEventListener('blur', () => {
          if (!input.getValue().trim()) {
            input.setValue(String(settings.timeoutSeconds));
            input.inputEl.setCustomValidity('');
            input.inputEl.setAttribute('aria-invalid', 'false');
          } else input.inputEl.reportValidity();
        });
      });
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
      'Where approved notes are sent. Keep http://127.0.0.1:8765 for Anki on this computer. Install AnkiConnect and keep Anki Desktop open while checking the connection or adding cards.',
      'ankiUrl',
      DEFAULTS.ankiUrl,
    );
    text(
      'AnkiConnect API key',
      'Leave blank for a default AnkiConnect installation. If you configured an API key in AnkiConnect, enter the same key here. This is not your AnkiWeb password; it is stored in this vault’s plugin settings.',
      'ankiKey',
      'Optional',
      true,
    );
    text(
      'Default deck',
      'Starting destination for new drafts. With One deck per book enabled, this is the parent, such as English::Books; otherwise it is the destination itself. Override it in a draft if needed. Changing this does not move existing cards or replace remembered book destinations.',
      'rootDeck',
      DEFAULTS.rootDeck,
    );
    new Setting(root)
      .setName('One deck per book')
      .setDesc(
        'Use a subdeck named after each Markdown file, for example English::Books::Animal Farm. Turn off to start new books in the default deck instead. A book can remember an explicitly chosen destination. Both exercises stay together.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.decksByBook).onChange((value) => {
          settings.decksByBook = value;
          this.plugin.persist();
        }),
      );
    text(
      'Note type',
      'The Anki note type containing the fields and two exercise templates. Keep Context Cards unless you need a separate compatible type. Created on first export if missing; an unrelated existing type can cause an incompatibility error. This does not change scheduling.',
      'noteType',
      DEFAULTS.noteType,
    );
    text(
      'Default tags',
      'Labels for finding notes in Anki. Separate tags with spaces, for example reading vocabulary. Edit them in each draft if needed; changing this does not retag existing notes.',
      'defaultTags',
      DEFAULTS.defaultTags,
    );
    new Setting(root)
      .setName('Check Anki')
      .setDesc(
        'Check that AnkiConnect is reachable and report the number of decks. Keep Anki Desktop open. This only reads the deck list; it does not create notes, cards or decks.',
      )
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
    new Setting(root).setName('Writing practice').setHeading();
    const writing = settings.writing;
    root.createEl('p', {
      cls: 'setting-item-description',
      text: 'Always checks grammar, vocabulary and spelling in American English.',
    });
    new Setting(root)
      .setName('Default exercise type')
      .setDesc(
        'Let AI choose a format for each correction, or set your preferred type. You can change it per correction before preparing cards. Deletions always use Correct the mistake.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            ai: 'Let AI choose',
            correction: 'Correct the mistake',
            gap: 'Fill in the gap',
          })
          .setValue(writing.exercise)
          .onChange((value) => {
            writing.exercise = value as typeof writing.exercise;
            this.plugin.persist();
          }),
      );
    text(
      'Writing deck',
      'Destination for cards made from your own writing mistakes. One approved finding creates one card; vocabulary decks are unchanged.',
      'writingDeck',
      DEFAULTS.writingDeck,
    );
    text(
      'Writing review folder',
      'Vault-relative folder for saved writing reviews. Reviews keep the selected text, corrections and Anki references. The original source note is not changed.',
      'writingReviewFolder',
      DEFAULTS.writingReviewFolder,
    );
    text(
      'Writing note type',
      'A separate Anki note type with one Practice template. Keep it different from the vocabulary note type.',
      'writingNoteType',
      DEFAULTS.writingNoteType,
    );
    new Setting(root).setName('Reading workflow').setHeading();
    new Setting(root)
      .setName('Selection button')
      .setDesc(
        'Show Explain word / phrase and Find mistakes beside a selection in Reading Mode and Live Preview.',
      )
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
      text: 'Commands: Explain word / phrase · Find mistakes · Open review panel · Check connections. Assign shortcuts under Obsidian → Hotkeys.',
    });
    this.dropdownCleanup = enhanceSelects(root);
  }
  hide() {
    this.dropdownCleanup?.();
    this.modelControl?.destroy();
    super.hide();
  }
}
