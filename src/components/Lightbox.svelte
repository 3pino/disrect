<script lang="ts">
  import LightboxView from '@3pino/viewer-kit-web/viewers/LightboxView.svelte';
  import { defaultViewers } from '@3pino/viewer-kit-web/viewers';
  import { failureText, type HostState } from '../lib/host.svelte';

  // 写真・PDF の拡大表示。表示そのもの（前後の切り替え・ビューアー・ツールバー）は土台（@3pino/viewer-kit-web）が受け持ち、
  // ここは本体の状態（host.shell.lightbox）につなぎ、「保存」を既定のアプリで開く操作にし、読めなかったときの文を決める。
  // 見た目は仮（利用者の確認を取っていない）。
  let { host, open }: { host: HostState; open: (req: { url: string; name: string }) => Promise<void> } = $props();
</script>

<LightboxView
  item={host.shell.lightbox}
  gallery={host.shell.lightboxGallery}
  viewers={defaultViewers}
  ondownload={(ev, item) => {
    ev.preventDefault();
    void open({ url: item.downloadUrl, name: item.alt });
    return true;
  }}
  errorText={failureText}
  onchange={(item) => (host.shell.lightbox = item)}
  onclose={() => (host.shell.lightbox = null)}
/>
