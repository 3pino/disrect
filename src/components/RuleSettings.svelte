<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Section from '@3pino/ui-kit-web/Section.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import Slider from '@3pino/ui-kit-web/Slider.svelte';
  import SortableList from '@3pino/ui-kit-web/SortableList.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import Toggle from '@3pino/ui-kit-web/Toggle.svelte';
  import IconPicker from './IconPicker.svelte';
  import { settings } from '../lib/settings.svelte';
  import { defaultRules, FIELD_LABEL, hueColor, KIND_LABEL, newRule, OP_LABEL, type AppearanceRule, type RuleCondition, type RuleField, type RuleLook, type RuleOp } from '../lib/rules';
  import { iconOf } from '../lib/ruleIcons';

  // 設定の「見た目のルール」: 条件に合うファイル・フォルダに、一覧のアイコン・色・不透明度を与える。
  // 条件は、すべてに合うとき（AND）に当たる。ルールは上のものほど優先（見た目の項目ごとに、最初に当たったものを使う）。
  // 並べ替えは共通の SortableList。ルールの中身は、「編集」を押すと、ダイアログで編集する（変えた内容は、すぐに保存される）。

  const rules = $derived(settings.rules);
  /** 編集しているルールの id */
  let editing = $state<string | null>(null);
  const current = $derived(rules.find((r) => r.id === editing) ?? null);
  /** 「デフォルトに戻す」の確認中 */
  let confirmReset = $state(false);

  const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const save = (list: AppearanceRule[]): void => {
    settings.rules = list;
  };
  function update(id: string, patch: Partial<AppearanceRule>): void {
    save(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function updateLook(id: string, look: RuleLook): void {
    // 空の値は、持たない（既定のまま）
    const clean: RuleLook = {};
    if (look.icon) clean.icon = look.icon;
    if (look.hue !== undefined) clean.hue = look.hue;
    if (look.color) clean.color = look.color;
    if (look.opacity !== undefined) clean.opacity = look.opacity;
    update(id, { look: clean });
  }
  function addRule(): void {
    const r = newRule(newId());
    save([...rules, r]);
    editing = r.id;
  }
  function removeRule(id: string): void {
    save(rules.filter((r) => r.id !== id));
    if (editing === id) editing = null;
  }
  function move(id: string, to: number): void {
    const from = rules.findIndex((r) => r.id === id);
    if (from < 0) return;
    const next = rules.filter((r) => r.id !== id);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, rules[from]);
    save(next);
  }
  /** ルールを、初めからのもの（defaultRules）に戻す。自分で足したルールは消える */
  function resetRules(): void {
    confirmReset = false;
    editing = null;
    save(defaultRules());
  }

  // ---- 条件 ----
  function setCondition(id: string, i: number, patch: Partial<RuleCondition>): void {
    const r = rules.find((x) => x.id === id);
    if (!r) return;
    const conditions = r.conditions.map((c, k) => {
      if (k !== i) return c;
      const next = { ...c, ...patch };
      // 種類は、「と等しい」だけ。値は、フォルダ・ファイルのどちらか
      if (next.field === 'kind') {
        next.op = 'is';
        if (next.value !== 'dir' && next.value !== 'file') next.value = 'dir';
      } else if (c.field === 'kind' && patch.field !== undefined) {
        next.value = '';
      }
      return next;
    });
    update(id, { conditions });
  }
  const addCondition = (id: string): void => {
    const r = rules.find((x) => x.id === id);
    if (r) update(id, { conditions: [...r.conditions, { field: 'basename', op: 'contains', value: '' }] });
  };
  const removeCondition = (id: string, i: number): void => {
    const r = rules.find((x) => x.id === id);
    if (r) update(id, { conditions: r.conditions.filter((_, k) => k !== i) });
  };
  /** 一覧に出す、ルールの説明（名前が無ければ、条件から） */
  function summary(r: AppearanceRule): string {
    if (r.name.trim() !== '') return r.name;
    if (r.conditions.length === 0) return '（条件なし）';
    return r.conditions.map((c) => `${FIELD_LABEL[c.field]}${c.not ? ' が' : ''}${c.field === 'kind' ? ` ${KIND_LABEL[c.value as 'dir' | 'file'] ?? c.value}` : ` ${c.value}`}`).join(' かつ ');
  }

  // ---- 見た目 ----
  type ColorMode = 'none' | 'hue' | 'color';
  const colorMode = (l: RuleLook): ColorMode => (l.color ? 'color' : l.hue !== undefined ? 'hue' : 'none');
  function setColorMode(id: string, look: RuleLook, mode: ColorMode): void {
    const { hue: _h, color: _c, ...rest } = look;
    updateLook(id, mode === 'hue' ? { ...rest, hue: look.hue ?? 200 } : mode === 'color' ? { ...rest, color: look.color ?? '#d9822b' } : rest);
  }
  const lookColor = (l: RuleLook): string | undefined => l.color ?? (l.hue !== undefined ? hueColor(l.hue) : undefined);
  const FIELDS = Object.keys(FIELD_LABEL) as RuleField[];
  const OPS = Object.keys(OP_LABEL) as RuleOp[];
</script>

<Section title="ルール" class="rules-list">
  <p class="muted rules-hint">条件に合うファイル・フォルダに、アイコン・色・不透明度を与えます。上のルールほど優先です。</p>
  {#if rules.length > 0}
    <SortableList items={rules} getId={(r) => r.id} getLabel={(r) => summary(r)} onmove={move} class="rules-sortable">
      {#snippet row(r)}
        {@const icon = iconOf(r.look.icon)}
        <SettingRow name={summary(r)} description={r.conditions.length > 0 ? undefined : '条件がないので、当たりません'} class="rule-row">
          {#snippet control()}
            <span class="rule-sample" style:color={lookColor(r.look)} style:opacity={r.look.opacity} aria-hidden="true">
              {#if icon && typeof icon === 'function'}{@const Icon = icon}<Icon size={16} />{:else if icon}<img src={icon.src} alt="" width="16" height="16" />{/if}
            </span>
            <IconButton class="rule-edit" label={`「${summary(r)}」を編集`} title="編集" onclick={() => (editing = r.id)}><Pencil size={16} /></IconButton>
            <Toggle checked={r.enabled} label={`「${summary(r)}」を使う`} onchange={(on) => update(r.id, { enabled: on })} />
          {/snippet}
        </SettingRow>
      {/snippet}
    </SortableList>
  {:else}
    <p class="muted rules-empty">ルールはありません。</p>
  {/if}
  <div class="rules-actions">
    <Button class="rule-add" icon={Plus} onclick={addRule}>ルールを足す</Button>
    {#if confirmReset}
      <span class="rules-confirm" role="alert">自分で足したルールも消えて、初めのルールに戻ります。</span>
      <Button class="rule-reset-yes" variant="danger" onclick={resetRules}>戻す</Button>
      <Button class="rule-reset-no" onclick={() => (confirmReset = false)}>やめる</Button>
    {:else}
      <Button class="rule-reset" icon={RotateCcw} onclick={() => (confirmReset = true)}>デフォルトに戻す</Button>
    {/if}
  </div>
</Section>

{#if current}
  {@const id = current.id}
  <Modal title="ルールの編集" width={720} onclose={() => (editing = null)}>
    <div class="rule-editor">
      <SettingRow name="名前（省略できます）">
        {#snippet control()}
          <TextInput class="rule-name" value={current.name} aria-label="ルールの名前" onchange={(ev) => update(id, { name: ev.currentTarget.value })} />
        {/snippet}
      </SettingRow>

      <h3 class="rule-sub">条件（すべてに合うとき）</h3>
      {#each current.conditions as c, i (i)}
        <div class="rule-cond" data-condition={i}>
          <select class="select rule-field" aria-label="調べるもの" value={c.field} onchange={(ev) => setCondition(id, i, { field: ev.currentTarget.value as RuleField })}>
            {#each FIELDS as f (f)}<option value={f}>{FIELD_LABEL[f]}</option>{/each}
          </select>
          <select class="select rule-op" aria-label="比べ方" value={c.op} disabled={c.field === 'kind'} onchange={(ev) => setCondition(id, i, { op: ev.currentTarget.value as RuleOp })}>
            {#each OPS as o (o)}<option value={o}>{OP_LABEL[o]}</option>{/each}
          </select>
          {#if c.field === 'kind'}
            <select class="select rule-value" aria-label="種類" value={c.value} onchange={(ev) => setCondition(id, i, { value: ev.currentTarget.value })}>
              <option value="dir">{KIND_LABEL.dir}</option>
              <option value="file">{KIND_LABEL.file}</option>
            </select>
          {:else}
            <TextInput class="rule-value" value={c.value} aria-label="値" placeholder={c.field === 'ext' ? '例: md（ドットなし）' : c.op === 'regex' ? '例: ^IMG_\\d+' : ''} spellcheck={false} onchange={(ev) => setCondition(id, i, { value: ev.currentTarget.value })} />
          {/if}
          <label class="rule-not"><input type="checkbox" checked={!!c.not} onchange={(ev) => setCondition(id, i, { not: ev.currentTarget.checked })} /> でない</label>
          <IconButton class="rule-cond-remove" label="この条件を消す" title="消す" onclick={() => removeCondition(id, i)}><X size={14} /></IconButton>
        </div>
      {/each}
      <div class="rules-actions">
        <Button class="rule-cond-add" icon={Plus} onclick={() => addCondition(id)}>条件を足す</Button>
      </div>

      <h3 class="rule-sub">見た目</h3>
      <h4 class="rule-sub-sub">アイコン</h4>
      <IconPicker value={current.look.icon} onpick={(name) => updateLook(id, { ...current.look, icon: name })} />

      <SettingRow name="色">
        {#snippet control()}
          <select class="select rule-color-mode" aria-label="色の決め方" value={colorMode(current.look)} onchange={(ev) => setColorMode(id, current.look, ev.currentTarget.value as ColorMode)}>
            <option value="none">既定のまま</option>
            <option value="hue">色相で決める</option>
            <option value="color">色を指定する</option>
          </select>
        {/snippet}
      </SettingRow>
      {#if current.look.hue !== undefined}
        <SettingRow name="色相">
          {#snippet control()}
            <Slider class="rule-hue" label="色相" min={0} max={360} value={current.look.hue} format={(v) => `${v}°`} onchange={(v) => updateLook(id, { ...current.look, hue: v })} />
          {/snippet}
        </SettingRow>
      {:else if current.look.color}
        <SettingRow name="色（CSS の色）">
          {#snippet control()}
            <TextInput class="rule-color" value={current.look.color} aria-label="色" placeholder="例: #d9822b・tomato" spellcheck={false} onchange={(ev) => updateLook(id, { ...current.look, color: ev.currentTarget.value })} />
          {/snippet}
        </SettingRow>
      {/if}
      <SettingRow name="不透明度を変える">
        {#snippet control()}
          <Toggle class="rule-opacity-on" checked={current.look.opacity !== undefined} label="不透明度を変える" onchange={(on) => updateLook(id, { ...current.look, opacity: on ? 0.6 : undefined })} />
        {/snippet}
      </SettingRow>
      <SettingRow name="不透明度">
        {#snippet control()}
          <Slider class="rule-opacity" label="不透明度" min={10} max={100} step={5} disabled={current.look.opacity === undefined} value={Math.round((current.look.opacity ?? 1) * 100)} format={(v) => `${v}%`} onchange={(v) => updateLook(id, { ...current.look, opacity: v / 100 })} />
        {/snippet}
      </SettingRow>

      <div class="rule-preview" aria-label="見え方">
        {#snippet sample(label: string)}
          {@const icon = iconOf(current.look.icon)}
          <span class="rule-preview-item" style:color={lookColor(current.look)} style:opacity={current.look.opacity}>
            {#if icon && typeof icon === 'function'}{@const Icon = icon}<Icon size={18} />{:else if icon}<img src={icon.src} alt="" width="18" height="18" />{/if}
            {label}
          </span>
        {/snippet}
        <span class="muted">見え方:</span>
        {@render sample('名前')}
      </div>

      <div class="rules-actions">
        <Button class="rule-remove" variant="danger" icon={Trash} onclick={() => removeRule(id)}>このルールを消す</Button>
        <Button class="rule-done" variant="primary" onclick={() => (editing = null)}>閉じる</Button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .rules-hint,
  .rules-empty {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-sm);
  }
  .rules-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .rules-confirm {
    font-size: var(--fs-sm);
  }
  .rule-sample {
    display: inline-flex;
    align-items: center;
    min-width: 16px;
  }
  .rule-editor {
    max-height: 75vh;
    overflow-y: auto;
  }
  .rule-sub {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--fs-base);
    font-weight: var(--fw-semibold);
  }
  .rule-sub-sub {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semibold);
    color: var(--text-muted);
  }
  /* 条件は、調べるもの・比べ方・値を、横に 1 行で並べる（狭いときだけ折り返す） */
  .rule-cond {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .rule-cond .rule-field {
    flex: none;
    width: 11.5em;
  }
  .rule-cond .rule-op {
    flex: none;
    width: 9.5em;
  }
  .rule-cond :global(.rule-value) {
    flex: 1;
    min-width: 6em;
  }
  .rule-not {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
  .rule-preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .rule-preview-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
