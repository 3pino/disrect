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
  // 並べ替え・使う／使わないは共通の SortableList で、すぐ保存される。ルールの中身は、「編集」を押すとダイアログで、
  // 写しを編集する（「保存」で反映。「キャンセル」・Esc・外を押すと、捨てる）。

  const rules = $derived(settings.rules);
  /** 編集している写し（ダイアログが開いているとき）と、それが新しいルールか */
  let draft = $state<AppearanceRule | null>(null);
  let isNew = $state(false);
  /** 「デフォルトに戻す」の確認（ポップアップ） */
  let confirmReset = $state(false);

  /** 色の決め方（色の設定を切っているときも、選びは覚えておく） */
  let colorKind = $state<'hue' | 'color'>('hue');

  const DEFAULT_HUE = 0;
  const DEFAULT_COLOR = '#777777';

  const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const save = (list: AppearanceRule[]): void => {
    settings.rules = list;
  };
  function update(id: string, patch: Partial<AppearanceRule>): void {
    save(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
    draft = null;
    save(defaultRules());
  }

  // ---- 編集（写しを直し、「保存」で反映する） ----
  function startEdit(r: AppearanceRule, fresh = false): void {
    draft = $state.snapshot(r) as AppearanceRule;
    isNew = fresh;
    colorKind = r.look.color ? 'color' : 'hue';
  }
  const addRule = (): void => startEdit(newRule(newId()), true);
  function saveDraft(): void {
    const d = draft;
    if (!d) return;
    // 空の値は、持たない（既定のまま）
    const look: RuleLook = {};
    if (d.look.icon) look.icon = d.look.icon;
    if (d.look.color) look.color = d.look.color;
    else if (d.look.hue !== undefined) look.hue = d.look.hue;
    if (d.look.opacity !== undefined) look.opacity = d.look.opacity;
    const next: AppearanceRule = { ...d, look };
    save(isNew ? [...rules, next] : rules.map((r) => (r.id === next.id ? next : r)));
    draft = null;
  }
  function removeDraft(): void {
    if (!draft) return;
    const id = draft.id;
    save(rules.filter((r) => r.id !== id));
    draft = null;
  }

  // ---- 条件 ----
  function setCondition(i: number, patch: Partial<RuleCondition>): void {
    if (!draft) return;
    draft.conditions = draft.conditions.map((c, k) => {
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
  }
  const addCondition = (): void => {
    if (draft) draft.conditions = [...draft.conditions, { field: 'basename', op: 'contains', value: '' }];
  };
  const removeCondition = (i: number): void => {
    if (draft) draft.conditions = draft.conditions.filter((_, k) => k !== i);
  };
  /** 一覧に出す、ルールの説明（名前が無ければ、条件から） */
  function summary(r: AppearanceRule): string {
    if (r.name.trim() !== '') return r.name;
    if (r.conditions.length === 0) return '（条件なし）';
    return r.conditions.map((c) => `${FIELD_LABEL[c.field]}${c.not ? ' が' : ''}${c.field === 'kind' ? ` ${KIND_LABEL[c.value as 'dir' | 'file'] ?? c.value}` : ` ${c.value}`}`).join(' かつ ');
  }

  // ---- 見た目 ----
  const colorOn = $derived(draft !== null && (draft.look.color !== undefined || draft.look.hue !== undefined));
  function setColorOn(on: boolean): void {
    if (!draft) return;
    const { hue: _h, color: _c, ...rest } = draft.look;
    draft.look = on ? (colorKind === 'color' ? { ...rest, color: DEFAULT_COLOR } : { ...rest, hue: DEFAULT_HUE }) : rest;
  }
  function setColorKind(kind: 'hue' | 'color'): void {
    colorKind = kind;
    if (colorOn) setColorOn(true);
  }
  const lookColor = (l: RuleLook): string | undefined => l.color ?? (l.hue !== undefined ? hueColor(l.hue) : undefined);
  const previewIcon = $derived(iconOf(draft?.look.icon));
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
            <IconButton class="rule-edit" label={`「${summary(r)}」を編集`} title="編集" onclick={() => startEdit(r)}><Pencil size={16} /></IconButton>
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
    <Button class="rule-reset" icon={RotateCcw} onclick={() => (confirmReset = true)}>デフォルトに戻す</Button>
  </div>
</Section>

{#if confirmReset}
  <Modal title="デフォルトに戻す" width={420} onclose={() => (confirmReset = false)}>
    <p class="rules-confirm">見た目のルールを、初めのルールに戻します。自分で足したルールや、直した内容は消えます。</p>
    <div class="modal-actions">
      <Button class="rule-reset-no" onclick={() => (confirmReset = false)}>キャンセル</Button>
      <Button class="rule-reset-yes" variant="danger" onclick={resetRules}>戻す</Button>
    </div>
  </Modal>
{/if}

{#if draft}
  {@const d = draft}
  <Modal title={isNew ? 'ルールを足す' : 'ルールの編集'} width={720} onclose={() => (draft = null)}>
    <div class="rule-editor">
      <SettingRow name="名前（省略できます）">
        {#snippet control()}
          <TextInput class="rule-name" value={d.name} aria-label="ルールの名前" oninput={(ev) => (d.name = ev.currentTarget.value)} />
        {/snippet}
      </SettingRow>

      <h3 class="rule-sub">条件（すべてに合うとき）</h3>
      {#each d.conditions as c, i (i)}
        <div class="rule-cond" data-condition={i}>
          <select class="select rule-field" aria-label="調べるもの" value={c.field} onchange={(ev) => setCondition(i, { field: ev.currentTarget.value as RuleField })}>
            {#each FIELDS as f (f)}<option value={f}>{FIELD_LABEL[f]}</option>{/each}
          </select>
          <select class="select rule-op" aria-label="比べ方" value={c.op} disabled={c.field === 'kind'} onchange={(ev) => setCondition(i, { op: ev.currentTarget.value as RuleOp })}>
            {#each OPS as o (o)}<option value={o}>{OP_LABEL[o]}</option>{/each}
          </select>
          {#if c.field === 'kind'}
            <select class="select rule-value" aria-label="種類" value={c.value} onchange={(ev) => setCondition(i, { value: ev.currentTarget.value })}>
              <option value="dir">{KIND_LABEL.dir}</option>
              <option value="file">{KIND_LABEL.file}</option>
            </select>
          {:else}
            <TextInput class="rule-value" value={c.value} aria-label="値" placeholder={c.field === 'ext' ? '例: md（ドットなし）' : c.op === 'regex' ? '例: ^IMG_\\d+' : ''} spellcheck={false} oninput={(ev) => setCondition(i, { value: ev.currentTarget.value })} />
          {/if}
          <label class="rule-not"><input type="checkbox" checked={!!c.not} onchange={(ev) => setCondition(i, { not: ev.currentTarget.checked })} /> でない</label>
          <IconButton class="rule-cond-remove" label="この条件を消す" title="消す" onclick={() => removeCondition(i)}><X size={14} /></IconButton>
        </div>
      {/each}
      <div class="rules-actions">
        <Button class="rule-cond-add" icon={Plus} onclick={addCondition}>条件を足す</Button>
      </div>

      <h3 class="rule-sub">見た目</h3>
      <IconPicker value={d.look.icon} onpick={(name) => (d.look = { ...d.look, icon: name })} />

      <div class="rule-line rule-line-color">
        <label class="rule-line-on"><input class="rule-color-on" type="checkbox" checked={colorOn} onchange={(ev) => setColorOn(ev.currentTarget.checked)} /> 色を設定する</label>
        <select class="select rule-color-mode" aria-label="色の決め方" value={colorKind} disabled={!colorOn} onchange={(ev) => setColorKind(ev.currentTarget.value as 'hue' | 'color')}>
          <option value="hue">色相で決める</option>
          <option value="color">色を指定する</option>
        </select>
        {#if colorKind === 'hue'}
          <Slider class="rule-hue" label="色相" min={0} max={360} disabled={!colorOn} value={d.look.hue ?? DEFAULT_HUE} format={(v) => `${v}°`} oninput={(v) => (d.look = { ...d.look, hue: v })} />
        {:else}
          <TextInput class="rule-color" value={d.look.color ?? DEFAULT_COLOR} disabled={!colorOn} aria-label="色" placeholder={`例: ${DEFAULT_COLOR}・tomato`} spellcheck={false} oninput={(ev) => (d.look = { ...d.look, color: ev.currentTarget.value })} />
        {/if}
      </div>
      <div class="rule-line rule-line-opacity">
        <label class="rule-line-on"><input class="rule-opacity-on" type="checkbox" checked={d.look.opacity !== undefined} onchange={(ev) => (d.look = { ...d.look, opacity: ev.currentTarget.checked ? 0.6 : undefined })} /> 不透明度を設定する</label>
        <Slider class="rule-opacity" label="不透明度" min={10} max={100} step={5} disabled={d.look.opacity === undefined} value={Math.round((d.look.opacity ?? 1) * 100)} format={(v) => `${v}%`} oninput={(v) => (d.look = { ...d.look, opacity: v / 100 })} />
      </div>

      <div class="rule-preview" aria-label="見え方">
        <span class="muted">見え方:</span>
        <span class="rule-preview-item" style:color={lookColor(d.look)} style:opacity={d.look.opacity}>
          {#if previewIcon && typeof previewIcon === 'function'}{@const Icon = previewIcon}<Icon size={18} />{:else if previewIcon}<img src={previewIcon.src} alt="" width="18" height="18" />{/if}
          名前
        </span>
      </div>

      <div class="rules-actions rule-editor-actions">
        {#if !isNew}<Button class="rule-remove" variant="danger" icon={Trash} onclick={removeDraft}>このルールを消す</Button>{/if}
        <span class="rule-editor-spacer"></span>
        <Button class="rule-cancel" onclick={() => (draft = null)}>キャンセル</Button>
        <Button class="rule-save" variant="primary" onclick={saveDraft}>保存</Button>
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
  .rule-editor-spacer {
    flex: 1;
  }
  .rules-confirm {
    margin: 0 0 var(--space-4);
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
  /* 条件は、調べるもの・比べ方・値を、横に 1 行で並べる */
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
  /* 色・不透明度: チェックボックスと、その設定（選び・バー・入力）を、横に 1 行で並べる */
  .rule-line {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
  .rule-line-on {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 11em;
  }
  .rule-line :global(.slider),
  .rule-line :global(.rule-color) {
    flex: 1;
    min-width: 0;
  }
  .rule-line .rule-color-mode {
    flex: none;
    width: 10em;
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
