# dsh-sidebar-notes · 侧边记事本

在 **DeepSeek Harness Web UI** 右侧栏打开的本地 Markdown 记事本插件：与聊天并排，不遮挡对话。

> A local Markdown notepad plugin for the DeepSeek Harness Web UI. It lives in the right sidebar as a tab, side by side with the chat.

## 功能

- 📝 **与聊天并排** —— 通过 `dsh-better-sidebar` 注册为右侧栏标签页，不占用聊天区域；未安装该插件时自动回退为「左侧图标 + 主面板」
- 🎛️ **Markdown 格式工具栏** —— 加粗、斜体、删除线、行内代码、标题、引用、无序 / 有序 / 任务列表、链接、代码块、表格、分隔线；支持 `Ctrl/⌘ + B / I / K`
- 👀 **三种视图** —— 编辑 / 上下分栏 / 预览
- 🗂️ **多篇笔记** —— 列表切换、新建、两段式删除确认
- 💾 **本地保存** —— 自动防抖写入浏览器 `localStorage`，刷新不丢
- 🌐 **中英文界面** —— 跟随宿主语言
- 🔒 **纯客户端、无网络请求** —— 只使用宿主公开契约（`ctx.slots` / `ctx.locale` / `ctx.get` / `styles` / `React`），不引入任何 `@deepseek-ai/dsh-client-ui-*` 内部包

## 安装

### 通过 dsh-market 插件市场（推荐）

在 DSH 的「插件 → 发现」中搜索 **Sidebar Notes / 侧边记事本**，一键安装。

或者直接用 DSH CLI 从 GitHub 安装：

```bash
dsh plugin add github:shizhouyu/dsh-sidebar-notes
```

### 从源码安装到本地 profile

1. 克隆本仓库到任意目录（例如 `~/.dsh/plugins/sidebar-notes`）；
2. 在 profile 的 `package.json` 中把该目录作为 `link:` 依赖安装，并把包名加入 `dsh.profile.bundles`；
3. 把下面的补丁写进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: sidebar-notes
      name: dsh-sidebar-notes
      config: {}
```

4. 刷新 DSH Web UI 页面。

## 使用

- 打开任意会话，点击聊天标题栏右侧的 **记事本图标**，右侧栏会自动打开记事本标签页；
- 或点击右侧栏顶部的 `+`，在列表中选择「记事本」；
- 首次打开会有一篇欢迎笔记，演示支持的 Markdown 语法。

## 开发

```bash
npm test              # node --check client.js && node _smoke.cjs
```

插件结构：

| 文件 | 说明 |
| --- | --- |
| `client.js` | Client 半：UI、Markdown 渲染器、右侧栏 / 图标 / 标题栏注册 |
| `index.js` | Host 半：空实现 |
| `cordis.patch.yml` | bundle 挂载补丁 |
| `locale/*.json` | 插件市场 / 设置页展示的标题与描述 |

## 兼容性

- 需要 DSH Web UI；
- 右侧栏标签页依赖 `dsh-better-sidebar`；未安装时自动回退到左侧图标 + 主面板。

## License

[MIT](LICENSE) © 2026 shizhouyu
