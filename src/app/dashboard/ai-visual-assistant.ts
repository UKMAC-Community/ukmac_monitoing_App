import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Icon } from '../components/icon';
import { Modal } from '../components/modal';
import { Api, errorText } from '../core/api';
import type { AiProvider, AiStatus } from '../core/ai-models';
import type { SheetWithRows } from '../core/models';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { newId } from './dashboard-model';
import { parseAiVisuals, validateAiSelection } from './ai-visual-model';
import { SheetDashboard } from './sheet-dashboard';
import { boardOf, chipLabel, STUDIO_TYPES, studioFields, type StudioVisual } from './studio-model';

export interface AiVisualSelection { sheetId: number; visuals: StudioVisual[]; }

@Component({
  selector: 'app-ai-visual-assistant',
  imports: [Icon, Modal, SheetDashboard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-visual-assistant.html',
  styleUrl: './ai-visual-assistant.css',
})
export class AiVisualAssistant {
  readonly sheet = input.required<SheetWithRows>();
  readonly formulas = input.required<WorkbookFormulas>();
  readonly closed = output<void>();
  readonly added = output<AiVisualSelection>();
  private readonly api = inject(Api);
  private requestId = '';
  private generatedFor = -1;
  private destroyed = false;
  readonly status = signal<AiStatus | null>(null);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly settingsOpen = signal(false);
  readonly provider = signal<AiProvider>('openrouter');
  readonly baseUrl = signal('https://openrouter.ai/api/v1');
  readonly model = signal('');
  readonly apiKey = signal('');
  readonly configBusy = signal(false);
  readonly connectionError = signal('');
  readonly connectionMessage = signal('');
  readonly prompt = signal('');
  readonly generating = signal(false);
  readonly cancelling = signal(false);
  readonly generationError = signal('');
  readonly suggestions = signal<StudioVisual[]>([]);
  readonly included = signal<string[]>([]);
  readonly previewId = signal('');
  readonly fields = computed(() => studioFields(this.formulas(), this.sheet()));
  readonly keepsKey = computed(() => this.status()?.hasKey && this.status()?.provider === this.provider() && this.status()?.baseUrl === this.normalizedUrl());
  readonly connectedToDraft = computed(() => !!this.status()?.configured && this.status()?.provider === this.provider() && this.status()?.baseUrl === this.normalizedUrl() && this.status()?.model === this.model().trim() && !this.apiKey());
  readonly canGenerate = computed(() => this.connectedToDraft() && !this.generating() && !this.configBusy() && !!this.prompt().trim() && !!this.fields().length && !this.loading());
  readonly previewBoard = computed(() => boardOf(this.suggestions().filter((v) => v.id === this.previewId())));
  readonly examples = computed(() => {
    const category = this.fields().find((field) => field.kind === 'text');
    return [category ? `Compare row counts by ${category.name}` : 'Show the total row count as a card', 'Create up to three useful visuals for this table'];
  });

  constructor() {
    void this.loadConnection();
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.apiKey.set('');
      const requestId = this.requestId;
      this.requestId = '';
      if (this.generating() && requestId) void this.api.aiCancelGeneration(requestId).catch(() => undefined);
    });
  }

  private normalizedUrl() { return this.baseUrl().trim().replace(/\/+$/, ''); }
  async loadConnection() {
    if (this.configBusy()) return;
    this.loading.set(true); this.loadFailed.set(false); this.connectionError.set('');
    try { this.applyConnection(await this.api.aiStatus()); }
    catch (error) { this.loadFailed.set(true); this.connectionError.set(errorText(error)); this.settingsOpen.set(true); }
    finally { this.loading.set(false); }
  }
  private applyConnection(status: AiStatus) {
    this.status.set(status); this.provider.set(status.provider); this.baseUrl.set(status.baseUrl); this.model.set(status.model); this.apiKey.set(''); this.settingsOpen.set(!status.configured);
  }
  chooseProvider(provider: AiProvider) {
    if (provider === this.provider()) return;
    this.provider.set(provider); this.baseUrl.set(provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:11434/v1'); this.model.set(''); this.apiKey.set(''); this.connectionMessage.set('');
  }
  useLocal(url: string) { this.baseUrl.set(url); this.model.set(''); this.apiKey.set(''); this.connectionMessage.set(''); }
  async saveConnection() {
    if (this.configBusy() || this.generating() || this.loading()) return;
    this.configBusy.set(true); this.connectionError.set(''); this.connectionMessage.set('');
    try {
      this.applyConnection(await this.api.aiSaveConnection({ provider: this.provider(), baseUrl: this.baseUrl().trim(), model: this.model().trim(), apiKey: this.apiKey().trim() || null }));
      this.connectionMessage.set('Connection saved. You can test it or generate visuals.');
    } catch (error) { this.connectionError.set(errorText(error)); }
    finally { this.configBusy.set(false); }
  }
  async testConnection() {
    if (this.configBusy() || this.generating() || !this.connectedToDraft()) return;
    this.configBusy.set(true); this.connectionError.set(''); this.connectionMessage.set('');
    try {
      const result = await this.api.aiTestConnection();
      if (result.modelAvailable) this.connectionMessage.set(result.message);
      else this.connectionError.set(result.message);
    } catch (error) { this.connectionError.set(errorText(error)); }
    finally { this.configBusy.set(false); }
  }
  async disconnect() {
    if (this.configBusy() || this.generating()) return;
    this.configBusy.set(true); this.connectionError.set(''); this.connectionMessage.set('');
    try { this.applyConnection(await this.api.aiClearConnection()); this.suggestions.set([]); this.included.set([]); this.connectionMessage.set('Connection removed.'); }
    catch (error) { this.connectionError.set(errorText(error)); }
    finally { this.configBusy.set(false); }
  }
  async generate() {
    if (!this.canGenerate()) return;
    const requestId = newId();
    this.requestId = requestId;
    const sheetId = this.sheet().sheetId;
    this.generating.set(true); this.generationError.set(''); this.suggestions.set([]); this.included.set([]);
    try {
      const content = await this.api.aiGenerateVisuals({ requestId, prompt: this.prompt().trim(), columns: this.fields().map(({ key, name, kind }) => ({ key, name, kind })), rowCount: this.sheet().rows.length, allowedTypes: STUDIO_TYPES.map((entry) => entry.type) });
      if (this.destroyed || this.requestId !== requestId || this.sheet().sheetId !== sheetId) return;
      const suggestions = parseAiVisuals(content, this.fields());
      this.generatedFor = sheetId;
      this.suggestions.set(suggestions); this.included.set(suggestions.map((v) => v.id)); this.previewId.set(suggestions[0].id);
    } catch (error) { if (!this.destroyed && this.requestId === requestId) this.generationError.set(errorText(error)); }
    finally { if (this.requestId === requestId) { this.generating.set(false); this.requestId = ''; } }
  }
  async cancel() {
    if (this.cancelling() || !this.generating()) return;
    const requestId = this.requestId;
    this.requestId = ''; this.cancelling.set(true);
    try { await this.api.aiCancelGeneration(requestId); this.generationError.set('Cancelled. No visuals were added.'); }
    catch (error) { this.generationError.set(errorText(error)); }
    finally { this.generating.set(false); this.cancelling.set(false); }
  }
  toggleIncluded(id: string) { this.included.update((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]); }
  typeLabel(visual: StudioVisual) { return STUDIO_TYPES.find((type) => type.type === visual.type)?.label ?? visual.type; }
  measureLabel(visual: StudioVisual) { return visual.values[0] ? chipLabel(visual.values[0], this.fields()) : ''; }
  addSelected() {
    const visuals = this.suggestions().filter((v) => this.included().includes(v.id));
    if (!visuals.length || this.generating()) return;
    try {
      if (this.generatedFor !== this.sheet().sheetId) throw new Error('This table changed. Generate new suggestions before adding them.');
      validateAiSelection(visuals, this.fields());
      this.added.emit({ sheetId: this.generatedFor, visuals });
    } catch (error) { this.generationError.set(errorText(error)); }
  }
}
