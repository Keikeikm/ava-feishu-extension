import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

declare const __FEISHU_DEBUG_BASE_URL__: string;

const root = createRoot(document.getElementById('root')!);

// The SDK exchanges messages with the parent frame provided by the Base host.
if (window.parent === window) {
  root.render(
    <main className="plugin-entry">
      <h1>请在飞书多维表格中打开 AVA</h1>
      <p>打开测试表，在视图栏点击「＋ → 更多插件」，添加本地的 AVA 数据表视图。</p>
      {__FEISHU_DEBUG_BASE_URL__ && (
        <a className="button primary" href={__FEISHU_DEBUG_BASE_URL__}>
          打开飞书调试表
        </a>
      )}
    </main>,
  );
} else {
  root.render(<App />);
}
