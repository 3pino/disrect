<script lang="ts">
  import { bridge } from './pdfThumbBridge';

  // PDF の 1 ページ目のサムネイル。描くのは本体（ui.renderPdfThumb。pdf.js は本体にあり、プラグインには入れない）。
  // ここは、枠いっぱいの箱を作って、本体へ渡すだけ。
  let { url, key }: { url: string; key: string } = $props();
  let el: HTMLSpanElement | undefined = $state();

  $effect(() => {
    const target = el;
    const u = url;
    const k = key;
    if (!target) return;
    return bridge.render?.(target, { url: u, key: k });
  });
</script>

<span bind:this={el} class="fxp-pdf-thumb"></span>

<style>
  .fxp-pdf-thumb {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
