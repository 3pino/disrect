import './lib/platformGlobal';
import { mount } from 'svelte';
import { defineBrandIcons } from '@3pino/ui-kit-web/brandIcons';
import './app.css';
import App from './App.svelte';

// 共通の独自アイコン（アプリのロゴなど）を、アイコンの登録簿に定義する
defineBrandIcons();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
