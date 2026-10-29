/**
 * 冒烟测试：在 Node（非浏览器）里用最小 React/宿主桩执行 client.js，
 * 验证插件 factory 可执行、apply 优先注册 better-sidebar 右侧栏标签页，
 * 且在没有 betterSidebar 时回退注册 main(key=notes) + sidebar.panellist(id=notes)。
 * 运行：node _smoke.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
let captured = null;
const storage = new Map();
const windowMock = {
  __ModuleLoader__: {
    load(options) {
      captured = options;
    },
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
};

const context = vm.createContext({
  window: windowMock,
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (callback) => callback(),
  // 宿主为动态 Client 插件提供的全局内置（Builtin：styles.insert）
  styles: { insert: () => () => {} },
  document: {
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
  },
});
vm.runInContext(source, context, { filename: 'client.js' });

if (!captured) throw new Error('ModuleLoader.load 未被调用');
if (captured.id !== '@local/dsh-sidebar-notes') throw new Error('模块 id 不符: ' + captured.id);

const modules = {
  react: {
    createElement: (type, props, ...children) => ({
      type,
      props: Object.assign({}, props, { children }),
    }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
  },
};

const plugin = captured.factory((id) => {
  if (!modules[id]) throw new Error('意外的 require: ' + id);
  return modules[id];
});
if (typeof plugin.apply !== 'function') throw new Error('缺少 apply');

const makeLocale = () => ({
  register: () => () => {},
  bind: () => (key) => key,
});

// ---------- 主路径：betterSidebar 存在 ----------
const services = {
  betterSidebar: {
    registeredTabs: [],
    opened: [],
    registerTab(descriptor) {
      this.registeredTabs.push(descriptor);
      return () => {};
    },
    openTab(seed) {
      this.opened.push(seed);
    },
  },
};
const registrations = [];
const ctx = {
  effect: (callback) => callback(),
  get: (name) => services[name],
  on: () => () => {},
  locale: makeLocale(),
  slots: {
    inject: (_owner, callback) => callback(),
    register: (descriptor, component) => registrations.push({ descriptor, component }),
  },
};
plugin.apply(ctx);

const tabs = services.betterSidebar.registeredTabs;
if (tabs.length !== 1) throw new Error('betterSidebar 标签页注册缺失');
const tab = tabs[0];
if (tab.id !== 'sidebar-notes:notes') throw new Error('标签页 id 不符: ' + tab.id);
if (typeof tab.title !== 'function' || !tab.title()) throw new Error('标签页 title 无效');
if (typeof tab.description !== 'function' || !tab.description()) throw new Error('标签页 description 无效');
if (tab.single !== true) throw new Error('标签页应单实例（single: true）');

const iconElement = tab.icon(16);
if (!iconElement || typeof iconElement.type !== 'function') throw new Error('标签页图标渲染失败');
const iconNode = iconElement.type(iconElement.props);
if (!iconNode || iconNode.type !== 'svg') throw new Error('标签页图标不是 svg');

// 主路径不注册旧的 main / sidebar.panellist
if (registrations.some((item) => item.descriptor.name === 'main')) {
  throw new Error('有 betterSidebar 时不应再注册 main 面板');
}

// 会话标题栏入口按钮
const header = registrations.find(
  (item) => item.descriptor.name === 'conversation.session.header.actions',
);
if (!header) throw new Error('会话标题栏入口注册缺失');
if (header.descriptor.id !== 'sidebar-notes:notes') throw new Error('标题栏入口 id 不符');
const headerElement = header.component();
if (!headerElement || typeof headerElement.type !== 'function') throw new Error('标题栏入口渲染失败');
const headerNode = headerElement.type(headerElement.props);
if (!headerNode || headerNode.type !== 'button') throw new Error('标题栏入口不是 button');
headerNode.props.onClick();
if (!services.betterSidebar.opened.some((seed) => seed && seed.type === 'sidebar-notes:notes')) {
  throw new Error('标题栏按钮没有调用 betterSidebar.openTab');
}

// 渲染面板，确认 Markdown 格式工具栏出现
const panelElement = tab.component({ visible: true });
const panelNode = panelElement.type(panelElement.props);
const hasClass = (node, className) => {
  if (!node || typeof node !== 'object') return false;
  const props = node.props || {};
  if (props.className && String(props.className).includes(className)) return true;
  const children = Array.isArray(props.children)
    ? props.children
    : props.children == null
      ? []
      : [props.children];
  return children.some((child) => hasClass(child, className));
};
if (!hasClass(panelNode, 'dsh-notes-mdbar')) throw new Error('Markdown 工具栏未渲染');
if (!hasClass(panelNode, 'dsh-notes-root is-tab')) throw new Error('面板没有 tab 变体样式类');

// ---------- 回退路径：没有 betterSidebar ----------
const fallbackRegistrations = [];
const fallbackCtx = {
  effect: (callback) => callback(),
  get: () => undefined,
  on: () => () => {},
  locale: makeLocale(),
  slots: {
    inject: (_owner, callback) => callback(),
    register: (descriptor, component) => fallbackRegistrations.push({ descriptor, component }),
  },
};
plugin.apply(fallbackCtx);

const main = fallbackRegistrations.find((item) => item.descriptor.name === 'main');
const panel = fallbackRegistrations.find((item) => item.descriptor.name === 'sidebar.panellist');
if (!main || main.descriptor.key !== 'notes') throw new Error('回退 main 面板注册缺失');
if (!panel || panel.descriptor.id !== 'notes') throw new Error('回退 sidebar.panellist 注册缺失');

console.log(
  'SMOKE_OK ' +
    JSON.stringify({
      name: plugin.name,
      inject: plugin.inject,
      tab: { id: tab.id, single: tab.single, order: tab.order },
      headerAction: header.descriptor.id,
      fallback: fallbackRegistrations.map((item) => ({
        name: item.descriptor.name,
        key: item.descriptor.key,
        id: item.descriptor.id,
      })),
    }),
);
