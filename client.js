/* ============================================================================
 * 侧边记事本 — Local DSH Web UI plugin (Client half)
 *
 * 一个从侧边栏打开的本地记事本：
 * - 优先通过 dsh-better-sidebar 的 `betterSidebar.registerTab()` 注册为右侧栏
 *   标签页（与聊天区并排，不遮挡对话）；没有该插件时回退到
 *   `sidebar.panellist` + `main` 面板；
 * - 会话标题栏 actions 放一个入口按钮，点击即打开右侧栏标签页；
 * - 面板内多篇笔记，支持编辑 / 分栏 / 预览三种视图，并带 Markdown 格式工具栏；
 * - Markdown 由本文件内的小型渲染器直接产出 React 元素（不解析 HTML，无 XSS 面）；
 * - 笔记保存在浏览器 localStorage，自动防抖保存。
 *
 * 只使用宿主公开的 Client 契约：ctx.slots / ctx.locale / ctx.get / styles / React。
 * 不引入任何 @deepseek-ai/dsh-client-ui-* 包，也不直接操作 DOM。
 * ========================================================================= */

window.__ModuleLoader__.load({
  id: 'dsh-sidebar-notes',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

    const NS = 'sidebar-notes';
    const name = 'sidebar-notes';
    const inject = ['slots', 'locale'];
    const PANEL_ID = 'notes';
    // 右侧栏标签页 id：dsh-better-sidebar 会把它同时注册成原生右侧栏的一种 kind。
    const TAB_ID = 'sidebar-notes:notes';
    const STORAGE_KEY = 'dsh-sidebar-notes.v1';

    /* ------------------------------------------------------------------ 文案 */

    const zh = {
      nav: '记事本',
      newNote: '新建',
      untitled: '未命名',
      emptyTitle: '还没有笔记',
      emptyHint: '点击「新建」开始记录，支持 Markdown 语法。',
      placeholder: '用 Markdown 写点什么…',
      edit: '编辑',
      split: '分栏',
      preview: '预览',
      remove: '删除',
      removeConfirm: '确定删除这篇笔记吗？',
      wordCount: '字',
      saved: '已保存',
      emptyPreview: '没有可预览的内容',
      listToggle: '展开 / 收起笔记列表',
      openInSidebar: '在右侧栏打开记事本',
      sidebarDescription: '本地 Markdown 记事本，与聊天并排显示',
      mdToolbar: 'Markdown 格式工具栏',
      mdBold: '加粗（Ctrl+B）',
      mdItalic: '斜体（Ctrl+I）',
      mdStrike: '删除线',
      mdCode: '行内代码',
      mdHeading: '标题',
      mdQuote: '引用',
      mdList: '无序列表',
      mdOrdered: '有序列表',
      mdTask: '任务列表',
      mdLink: '链接（Ctrl+K）',
      mdCodeBlock: '代码块',
      mdTable: '表格',
      mdHr: '分隔线',
      mdPlaceholderText: '文本',
      mdPlaceholderLink: '链接文字',
    };

    const en = {
      nav: 'Notes',
      newNote: 'New',
      untitled: 'Untitled',
      emptyTitle: 'No notes yet',
      emptyHint: 'Click “New” to start writing. Markdown is supported.',
      placeholder: 'Write something in Markdown…',
      edit: 'Edit',
      split: 'Split',
      preview: 'Preview',
      remove: 'Delete',
      removeConfirm: 'Delete this note?',
      wordCount: 'chars',
      saved: 'Saved',
      emptyPreview: 'Nothing to preview',
      listToggle: 'Expand / collapse the note list',
      openInSidebar: 'Open notes in the sidebar',
      sidebarDescription: 'A local Markdown notepad, side by side with the chat',
      mdToolbar: 'Markdown format toolbar',
      mdBold: 'Bold (Ctrl+B)',
      mdItalic: 'Italic (Ctrl+I)',
      mdStrike: 'Strikethrough',
      mdCode: 'Inline code',
      mdHeading: 'Heading',
      mdQuote: 'Quote',
      mdList: 'Bullet list',
      mdOrdered: 'Numbered list',
      mdTask: 'Task list',
      mdLink: 'Link (Ctrl+K)',
      mdCodeBlock: 'Code block',
      mdTable: 'Table',
      mdHr: 'Horizontal rule',
      mdPlaceholderText: 'text',
      mdPlaceholderLink: 'link text',
    };

    /* ------------------------------------------------------------ 本地存储 */

    /** 首次打开时的欢迎笔记，顺带演示支持的 Markdown 语法。 */
    const WELCOME_CONTENT = [
      '# 欢迎使用侧边记事本',
      '',
      '这是从**侧边栏图标**打开的本地记事本，支持 Markdown 语法。',
      '',
      '## 使用方式',
      '',
      '- 左侧列表管理多篇笔记，点顶部「新建」添加',
      '- 支持编辑 / 分栏 / 预览三种视图',
      '- 内容自动保存到浏览器本地，刷新后仍在',
      '',
      '> 提示：随时点击侧边栏的记事本图标打开。',
      '',
      '### 支持的语法',
      '',
      '1. 标题、**加粗**、*斜体*、~~删除线~~、`行内代码`',
      '2. 列表、引用、分隔线、链接与图片',
      '3. 代码块与表格',
      '',
      '```js',
      'const hello = (name) => `你好，${name}`;',
      '```',
      '',
      '| 功能 | 状态 |',
      '| --- | --- |',
      '| Markdown 预览 | 已支持 |',
      '| 本地保存 | 已支持 |',
      '',
      '- [x] 试试点击任务列表',
      '- [ ] 写下一条自己的笔记',
      '',
      '---',
      '',
      '*开始记录吧。*',
    ].join('\n');

    const createId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const makeWelcomeNotebook = () => {
      const id = createId();
      return {
        version: 1,
        activeId: id,
        notes: [{ id, content: WELCOME_CONTENT, updatedAt: Date.now() }],
      };
    };

    /** 读取本地笔记；localStorage 不可用或数据损坏时退回欢迎笔记。 */
    const loadNotebook = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.notes)) {
            const notes = parsed.notes.filter(
              (note) => note && typeof note.id === 'string' && typeof note.content === 'string',
            );
            if (notes.length > 0) {
              const activeId = notes.some((note) => note.id === parsed.activeId)
                ? parsed.activeId
                : notes[0].id;
              return { version: 1, activeId, notes };
            }
          }
        }
      } catch (error) {
        /* 隐私模式或损坏数据：用欢迎笔记继续，不打断面板渲染。 */
      }
      return makeWelcomeNotebook();
    };

    const saveNotebook = (notebook) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notebook));
        return true;
      } catch (error) {
        return false;
      }
    };

    /* -------------------------------------------------------- Markdown 渲染 */

    /** 只放行安全协议，其他链接按无效处理，避免 javascript: 之类注入。 */
    const safeUrl = (raw) => {
      const url = String(raw == null ? '' : raw).trim();
      if (!url) return '#';
      if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(url)) return url;
      return '#';
    };

    const isBlank = (line) => line.trim() === '';

    /**
     * 行内语法：`code`、**加粗**、*斜体*、~~删除线~~、[链接](url)、![图片](url)、\ 转义。
     * 返回 React 子节点数组（字符串与元素混排），不产生 HTML 字符串。
     */
    const renderInline = (text) => {
      const nodes = [];
      let i = 0;
      let buffer = '';

      const flush = () => {
        if (buffer) {
          nodes.push(buffer);
          buffer = '';
        }
      };

      while (i < text.length) {
        const ch = text[i];

        if (ch === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!~>|]/.test(text[i + 1])) {
          buffer += text[i + 1];
          i += 2;
          continue;
        }

        if (ch === '`') {
          const end = text.indexOf('`', i + 1);
          if (end > -1) {
            let code = text.slice(i + 1, end);
            if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) {
              code = code.slice(1, -1);
            }
            flush();
            nodes.push(h('code', { key: 'c' + nodes.length, className: 'dsh-notes-inline-code' }, code));
            i = end + 1;
            continue;
          }
        }

        if (ch === '!' && text[i + 1] === '[') {
          const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(text.slice(i));
          if (match) {
            flush();
            nodes.push(
              h('img', {
                key: 'i' + nodes.length,
                className: 'dsh-notes-img',
                src: safeUrl(match[2]),
                alt: match[1],
                title: match[3] || undefined,
              }),
            );
            i += match[0].length;
            continue;
          }
        }

        if (ch === '[') {
          const match = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(text.slice(i));
          if (match) {
            flush();
            nodes.push(
              h(
                'a',
                {
                  key: 'a' + nodes.length,
                  className: 'dsh-notes-link',
                  href: safeUrl(match[2]),
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  title: match[3] || undefined,
                },
                match[1],
              ),
            );
            i += match[0].length;
            continue;
          }
        }

        if (ch === '~' && text[i + 1] === '~') {
          const end = text.indexOf('~~', i + 2);
          if (end > i + 1) {
            flush();
            nodes.push(h('del', { key: 'd' + nodes.length }, renderInline(text.slice(i + 2, end))));
            i = end + 2;
            continue;
          }
        }

        if (ch === '*') {
          if (text.slice(i, i + 3) === '***') {
            const end = text.indexOf('***', i + 3);
            if (end > i + 2) {
              flush();
              nodes.push(
                h(
                  'strong',
                  { key: 's' + nodes.length },
                  h('em', null, renderInline(text.slice(i + 3, end))),
                ),
              );
              i = end + 3;
              continue;
            }
          }
          if (text.slice(i, i + 2) === '**') {
            const end = text.indexOf('**', i + 2);
            if (end > i + 1) {
              flush();
              nodes.push(h('strong', { key: 's' + nodes.length }, renderInline(text.slice(i + 2, end))));
              i = end + 2;
              continue;
            }
          }
          const end = text.indexOf('*', i + 1);
          if (end > i) {
            flush();
            nodes.push(h('em', { key: 'e' + nodes.length }, renderInline(text.slice(i + 1, end))));
            i = end + 1;
            continue;
          }
        }

        if (ch === '_') {
          if (text.slice(i, i + 2) === '__') {
            const end = text.indexOf('__', i + 2);
            if (end > i + 1) {
              flush();
              nodes.push(h('strong', { key: 's' + nodes.length }, renderInline(text.slice(i + 2, end))));
              i = end + 2;
              continue;
            }
          } else {
            const prev = i === 0 ? '' : text[i - 1];
            const end = text.indexOf('_', i + 1);
            if (
              (!prev || !/[\w]/.test(prev)) &&
              end > i + 1 &&
              (!text[end + 1] || !/[\w]/.test(text[end + 1]))
            ) {
              flush();
              nodes.push(h('em', { key: 'e' + nodes.length }, renderInline(text.slice(i + 1, end))));
              i = end + 1;
              continue;
            }
          }
        }

        buffer += ch;
        i += 1;
      }

      flush();
      return nodes;
    };

    const LIST_LINE = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

    /** 解析一段连续列表行；按缩进用栈构建嵌套树。 */
    const parseList = (lines, start) => {
      const items = [];
      const stack = [];
      let baseIndent = null;
      let i = start;

      while (i < lines.length) {
        const match = LIST_LINE.exec(lines[i]);
        if (!match) break;
        const indent = match[1].length;
        if (baseIndent === null) baseIndent = indent;
        if (indent < baseIndent) break;

        const item = {
          ordered: /\d/.test(match[2]),
          text: match[3],
          children: [],
        };
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
        if (stack.length === 0) items.push(item);
        else stack[stack.length - 1].children.push(item);
        stack.push({ indent, children: item.children });
        i += 1;
      }

      return { next: i, items };
    };

    const renderListNodes = (items, prefix) => {
      const groups = [];
      let current = null;
      for (const item of items) {
        if (!current || current.ordered !== item.ordered) {
          current = { ordered: item.ordered, items: [] };
          groups.push(current);
        }
        current.items.push(item);
      }

      return groups.map((group, groupIndex) =>
        h(
          group.ordered ? 'ol' : 'ul',
          { key: prefix + 'g' + groupIndex, className: 'dsh-notes-list' },
          group.items.map((item, itemIndex) => {
            const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(item.text);
            const body = task ? item.text.slice(task[0].length) : item.text;
            return h(
              'li',
              {
                key: itemIndex,
                className: task ? 'dsh-notes-li dsh-notes-li-task' : 'dsh-notes-li',
              },
              task
                ? h('input', {
                    type: 'checkbox',
                    className: 'dsh-notes-check',
                    checked: task[1].toLowerCase() === 'x',
                    readOnly: true,
                  })
                : null,
              renderInline(body),
              item.children.length > 0
                ? renderListNodes(item.children, prefix + itemIndex + '.')
                : null,
            );
          }),
        ),
      );
    };

    const TABLE_SEPARATOR =
      /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;

    const splitTableRow = (row) => {
      let value = row.trim();
      if (value.startsWith('|')) value = value.slice(1);
      if (value.endsWith('|')) value = value.slice(0, -1);
      return value.split('|').map((cell) => cell.trim());
    };

    const parseTable = (lines, start, key) => {
      const header = splitTableRow(lines[start]);
      const aligns = splitTableRow(lines[start + 1]).map((cell) => {
        if (/^:-+:$/.test(cell)) return 'center';
        if (/^-+:$/.test(cell)) return 'right';
        if (/^:-+$/.test(cell)) return 'left';
        return undefined;
      });
      const rows = [];
      let i = start + 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }

      const cellStyle = (index) => (aligns[index] ? { textAlign: aligns[index] } : undefined);

      return {
        next: i,
        node: h(
          'div',
          { key, className: 'dsh-notes-table-wrap' },
          h(
            'table',
            { className: 'dsh-notes-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                header.map((cell, index) =>
                  h('th', { key: index, style: cellStyle(index) }, renderInline(cell)),
                ),
              ),
            ),
            rows.length > 0
              ? h(
                  'tbody',
                  null,
                  rows.map((row, rowIndex) =>
                    h(
                      'tr',
                      { key: rowIndex },
                      header.map((_, cellIndex) =>
                        h(
                          'td',
                          { key: cellIndex, style: cellStyle(cellIndex) },
                          renderInline(row[cellIndex] || ''),
                        ),
                      ),
                    ),
                  ),
                )
              : null,
          ),
        ),
      };
    };

    const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;

    /** 块级语法：标题、代码块、引用、表格、列表、分隔线、段落。 */
    const parseBlocks = (source) => {
      const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        if (isBlank(line)) {
          i += 1;
          continue;
        }

        // 围栏代码块（``` 或 ~~~）
        const fence = FENCE_LINE.exec(line);
        if (fence) {
          const char = fence[2][0];
          const length = fence[2].length;
          const close = new RegExp('^ {0,3}' + (char === '`' ? '`' : '~') + '{' + length + ',}[ \\t]*$');
          const body = [];
          i += 1;
          while (i < lines.length && !close.test(lines[i])) {
            body.push(lines[i]);
            i += 1;
          }
          if (i < lines.length) i += 1;
          blocks.push(
            h(
              'pre',
              { key: 'b' + blocks.length, className: 'dsh-notes-pre' },
              h(
                'code',
                {
                  className:
                    'dsh-notes-code' + (fence[3] ? ' language-' + fence[3] : ''),
                },
                body.join('\n'),
              ),
            ),
          );
          continue;
        }

        // ATX 标题
        const heading = /^( {0,3})(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
        if (heading) {
          const level = heading[2].length;
          blocks.push(
            h(
              'h' + level,
              { key: 'b' + blocks.length, className: 'dsh-notes-heading' },
              renderInline(heading[3]),
            ),
          );
          i += 1;
          continue;
        }

        // 分隔线
        if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) {
          blocks.push(h('hr', { key: 'b' + blocks.length, className: 'dsh-notes-hr' }));
          i += 1;
          continue;
        }

        // 引用（可嵌套）
        if (/^ {0,3}>/.test(line)) {
          const quoted = [];
          while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
            quoted.push(lines[i].replace(/^ {0,3}>[ \t]?/, ''));
            i += 1;
          }
          blocks.push(
            h(
              'blockquote',
              { key: 'b' + blocks.length, className: 'dsh-notes-quote' },
              parseBlocks(quoted.join('\n')),
            ),
          );
          continue;
        }

        // 表格：当前行含 | 且下一行是分隔行
        if (i + 1 < lines.length && line.includes('|') && TABLE_SEPARATOR.test(lines[i + 1])) {
          const table = parseTable(lines, i, 'b' + blocks.length);
          blocks.push(table.node);
          i = table.next;
          continue;
        }

        // 列表
        if (LIST_LINE.test(line)) {
          const list = parseList(lines, i);
          if (list.items.length > 0) {
            blocks.push(
              h(
                'div',
                { key: 'b' + blocks.length, className: 'dsh-notes-listblock' },
                renderListNodes(list.items, 'l' + blocks.length + '.'),
              ),
            );
            i = list.next;
            continue;
          }
        }

        // 段落：合并到空行或下一个块起始为止
        const paragraph = [];
        while (i < lines.length) {
          const current = lines[i];
          if (isBlank(current)) break;
          if (/^ {0,3}(#{1,6})[ \t]+/.test(current)) break;
          if (FENCE_LINE.test(current)) break;
          if (/^ {0,3}>/.test(current)) break;
          if (LIST_LINE.test(current)) break;
          if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(current)) break;
          if (
            current.includes('|') &&
            i + 1 < lines.length &&
            TABLE_SEPARATOR.test(lines[i + 1])
          ) {
            break;
          }
          paragraph.push(current.trim());
          i += 1;
        }
        if (paragraph.length > 0) {
          blocks.push(
            h('p', { key: 'b' + blocks.length, className: 'dsh-notes-p' }, renderInline(paragraph.join(' '))),
          );
        }
      }

      return blocks;
    };

    /** 预览区：把 Markdown 源码渲染成 React 节点。 */
    const MarkdownView = ({ content }) => {
      const nodes = useMemo(() => parseBlocks(content), [content]);
      return h('div', { className: 'dsh-notes-md' }, nodes);
    };

    /* -------------------------------------------------------------- 小图标 */

    const Svg = ({ size = 14, children }) =>
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        children,
      );

    const ListIcon = () =>
      h(Svg, null, h('path', {
        d: 'M2.5 4h11M2.5 8h11M2.5 12h11',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      }));

    const PlusIcon = () =>
      h(Svg, null, h('path', {
        d: 'M8 3v10M3 8h10',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      }));

    const TrashIcon = () =>
      h(Svg, { size: 13 }, h('path', {
        d: 'M3 4.4h10M6.4 4.4V3.1h3.2v1.3M4.7 4.4l.6 8.2h5.4l.6-8.2',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }));

    /** 侧边栏图标：便签纸 + 折角 + 文字行。active 时用品牌色，其余继承侧栏文字色。 */
    const NotesIcon = ({ size = 16, active = false }) =>
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          style: active ? { color: 'var(--dsw-alias-brand-primary)' } : undefined,
        },
        h('path', {
          d: 'M3.25 1.75h6.4l3.1 3.1v9.4a.5.5 0 0 1-.5.5H3.75a.5.5 0 0 1-.5-.5V2.25a.5.5 0 0 1 .5-.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M9.65 1.9v3.1h3.1',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M5.4 7.1h5.2M5.4 9.2h5.2M5.4 11.3h3.3',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      );

    /* -------------------------------------------------------------- 面板 UI */

    const formatTime = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const now = new Date();
      const sameDay = date.toDateString() === now.toDateString();
      return sameDay
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString();
    };

    /** 笔记标题取正文首个非空行，去掉常见 Markdown 前缀与强调符。 */
    const noteTitle = (content) => {
      const first =
        String(content || '')
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean) || '';
      const clean = first
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s*/, '')
        .replace(/^([-*+]|\d{1,9}[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .replace(/[*_~`]/g, '')
        .trim();
      return clean.slice(0, 32);
    };

    const NotesPanel = ({ t, variant }) => {
      const [notebook, setNotebook] = useState(loadNotebook);
      // 右侧栏通常较窄，默认只显示编辑区，需要对照时再切到分栏/预览。
      const [mode, setMode] = useState('edit');
      const [listOpen, setListOpen] = useState(true);
      const [pendingRemove, setPendingRemove] = useState(null);
      const editorRef = useRef(null);
      const saveFailedRef = useRef(false);

      const notes = notebook.notes;
      const active = notes.find((note) => note.id === notebook.activeId) || notes[0] || null;

      // 输入停止 300ms 后自动落盘，避免每个字符都写 localStorage。
      useEffect(() => {
        const timer = setTimeout(() => {
          saveFailedRef.current = !saveNotebook(notebook);
        }, 300);
        return () => clearTimeout(timer);
      }, [notebook]);

      const updateContent = (id, content) => {
        setNotebook((prev) => ({
          ...prev,
          notes: prev.notes.map((note) =>
            note.id === id ? { ...note, content, updatedAt: Date.now() } : note,
          ),
        }));
      };

      /**
       * Markdown 工具栏动作，按类型作用于 textarea 当前选区：
       * - wrap：在选区两侧包裹标记；没有选区时插入占位文字并选中，直接改写即可；
       * - prefix：给选区覆盖的每一行（无选区时为当前行）加行首标记；
       * - block：插入独立的代码块 / 表格 / 分隔线，光标停到块内预设offset。
       * 受控 textarea 在 setState 后会重渲染，所以选区恢复要放到 rAF 里。
       */
      const applyMarkdown = (spec) => {
        const el = editorRef.current;
        if (!el || !active) return;
        const value = el.value;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selected = value.slice(start, end);
        let next = value;
        let selStart = start;
        let selEnd = end;

        if (spec.type === 'wrap') {
          const body = selected || spec.placeholder || '';
          next = value.slice(0, start) + spec.before + body + spec.after + value.slice(end);
          selStart = start + spec.before.length;
          selEnd = selStart + body.length;
        } else if (spec.type === 'prefix') {
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          let lineEnd = value.indexOf('\n', end > start ? end : start);
          if (lineEnd < 0) lineEnd = value.length;
          const block = value.slice(lineStart, lineEnd);
          const prefixed = block.split('\n').map((line) => spec.prefix + line).join('\n');
          next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
          selStart = lineStart;
          selEnd = lineStart + prefixed.length;
        } else {
          const lead = spec.leadNewline ? '\n' : '';
          const trail = spec.trailNewline ? '\n' : '';
          const block = lead + spec.block + trail;
          next = value.slice(0, start) + block + value.slice(end);
          const caret = typeof spec.caret === 'number' ? spec.caret : block.length;
          selStart = start + lead.length + caret;
          selEnd = selStart;
        }

        updateContent(active.id, next);
        requestAnimationFrame(() => {
          const node = editorRef.current;
          if (!node) return;
          node.focus();
          node.setSelectionRange(selStart, selEnd);
        });
      };

      // 工具栏按钮：用纯文本符号，避免再引入图标依赖；title 走 i18n 便于悬停提示。
      const mdActions = [
        { key: 'bold', label: 'B', className: 'is-strong', title: t('mdBold'), spec: { type: 'wrap', before: '**', after: '**', placeholder: t('mdPlaceholderText') } },
        { key: 'italic', label: 'I', className: 'is-italic', title: t('mdItalic'), spec: { type: 'wrap', before: '*', after: '*', placeholder: t('mdPlaceholderText') } },
        { key: 'strike', label: 'S', className: 'is-strike', title: t('mdStrike'), spec: { type: 'wrap', before: '~~', after: '~~', placeholder: t('mdPlaceholderText') } },
        { key: 'code', label: '</>', className: 'is-code', title: t('mdCode'), spec: { type: 'wrap', before: '`', after: '`', placeholder: t('mdPlaceholderText') } },
        { key: 'heading', label: 'H', className: 'is-strong', title: t('mdHeading'), spec: { type: 'prefix', prefix: '## ' } },
        { key: 'quote', label: '❝', title: t('mdQuote'), spec: { type: 'prefix', prefix: '> ' } },
        { key: 'list', label: '•', title: t('mdList'), spec: { type: 'prefix', prefix: '- ' } },
        { key: 'ordered', label: '1.', title: t('mdOrdered'), spec: { type: 'prefix', prefix: '1. ' } },
        { key: 'task', label: '☑', title: t('mdTask'), spec: { type: 'prefix', prefix: '- [ ] ' } },
        { key: 'link', label: '🔗', title: t('mdLink'), spec: { type: 'wrap', before: '[', after: '](https://)', placeholder: t('mdPlaceholderLink') } },
        { key: 'codeblock', label: '{ }', className: 'is-code', title: t('mdCodeBlock'), spec: { type: 'block', block: '```\n\n```', leadNewline: true, trailNewline: true, caret: 4 } },
        { key: 'table', label: '▦', title: t('mdTable'), spec: { type: 'block', block: '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |', leadNewline: true, trailNewline: true, caret: 0 } },
        { key: 'hr', label: '—', title: t('mdHr'), spec: { type: 'block', block: '---', leadNewline: true, trailNewline: true, caret: 0 } },
      ];

      const selectNote = (id) => {
        setPendingRemove(null);
        setNotebook((prev) => ({ ...prev, activeId: id }));
      };

      const createNote = () => {
        const id = createId();
        setPendingRemove(null);
        setNotebook((prev) => ({
          ...prev,
          activeId: id,
          notes: [{ id, content: '', updatedAt: Date.now() }, ...prev.notes],
        }));
        requestAnimationFrame(() => {
          if (editorRef.current) editorRef.current.focus();
        });
      };

      // 两段式删除：宿主不保证 window.confirm 可用，第一次点击先进入待确认态。
      const removeNote = (id) => {
        if (pendingRemove !== id) {
          setPendingRemove(id);
          return;
        }
        setPendingRemove(null);
        setNotebook((prev) => {
          const remaining = prev.notes.filter((note) => note.id !== id);
          return {
            ...prev,
            notes: remaining,
            activeId:
              prev.activeId === id ? (remaining.length > 0 ? remaining[0].id : null) : prev.activeId,
          };
        });
      };

      const renderEditor = () =>
        h('textarea', {
          ref: editorRef,
          className: 'dsh-notes-editor',
          value: active.content,
          placeholder: t('placeholder'),
          spellCheck: false,
          onChange: (event) => updateContent(active.id, event.target.value),
          onKeyDown: (event) => {
            // 常用 Markdown 快捷键：Ctrl/⌘ + B / I / K。
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            const key = (event.key || '').toLowerCase();
            const shortcut =
              key === 'b'
                ? { type: 'wrap', before: '**', after: '**', placeholder: t('mdPlaceholderText') }
                : key === 'i'
                  ? { type: 'wrap', before: '*', after: '*', placeholder: t('mdPlaceholderText') }
                  : key === 'k'
                    ? { type: 'wrap', before: '[', after: '](https://)', placeholder: t('mdPlaceholderLink') }
                    : null;
            if (!shortcut) return;
            event.preventDefault();
            applyMarkdown(shortcut);
          },
        });

      const renderPreview = () =>
        active.content.trim()
          ? h(MarkdownView, { content: active.content })
          : h('div', { className: 'dsh-notes-placeholder' }, t('emptyPreview'));

      const renderMain = () => {
        if (!active) {
          return h(
            'div',
            { className: 'dsh-notes-empty' },
            h('div', { className: 'dsh-notes-empty-title' }, t('emptyTitle')),
            h('div', { className: 'dsh-notes-empty-hint' }, t('emptyHint')),
            h(
              'button',
              { type: 'button', className: 'dsh-notes-btn', onClick: createNote },
              h(PlusIcon),
              h('span', null, t('newNote')),
            ),
          );
        }

        if (mode === 'edit') {
          return renderEditor();
        }
        if (mode === 'preview') {
          return h('div', { className: 'dsh-notes-preview-solo' }, renderPreview());
        }
        return h(
          'div',
          { className: 'dsh-notes-split' },
          renderEditor(),
          h('div', { className: 'dsh-notes-preview' }, renderPreview()),
        );
      };

      const charCount = active ? active.content.replace(/\s/g, '').length : 0;

      return h(
        'div',
        { className: 'dsh-notes-root' + (variant === 'tab' ? ' is-tab' : '') },
        h(
          'header',
          { className: 'dsh-notes-toolbar' },
          h(
            'div',
            { className: 'dsh-notes-titlebar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-notes-iconbtn',
                title: t('listToggle'),
                'aria-label': t('listToggle'),
                'aria-pressed': listOpen,
                onClick: () => setListOpen((open) => !open),
              },
              h(ListIcon),
            ),
            h('span', { className: 'dsh-notes-brand' }, t('nav')),
          ),
          h(
            'div',
            { className: 'dsh-notes-actions' },
            h(
              'div',
              { className: 'dsh-notes-segmented', role: 'group' },
              ['edit', 'split', 'preview'].map((value) =>
                h(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    className:
                      'dsh-notes-seg' + (mode === value ? ' is-active' : ''),
                    'aria-pressed': mode === value,
                    onClick: () => setMode(value),
                  },
                  t(value),
                ),
              ),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-notes-btn', onClick: createNote },
              h(PlusIcon),
              h('span', null, t('newNote')),
            ),
          ),
        ),
        mode !== 'preview' && active
          ? h(
              'div',
              { className: 'dsh-notes-mdbar', role: 'toolbar', 'aria-label': t('mdToolbar') },
              mdActions.map((action) =>
                h(
                  'button',
                  {
                    key: action.key,
                    type: 'button',
                    className:
                      'dsh-notes-mdbtn' + (action.className ? ' ' + action.className : ''),
                    title: action.title,
                    'aria-label': action.title,
                    onClick: () => applyMarkdown(action.spec),
                  },
                  action.label,
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dsh-notes-body' },
          listOpen
            ? h(
                'aside',
                { className: 'dsh-notes-sidebar' },
                h(
                  'div',
                  { className: 'dsh-notes-listhead' },
                  h('span', null, t('nav')),
                  h('span', { className: 'dsh-notes-count' }, String(notes.length)),
                ),
                h(
                  'div',
                  { className: 'dsh-notes-list' },
                  notes.length === 0
                    ? h('div', { className: 'dsh-notes-list-empty' }, t('emptyHint'))
                    : notes.map((note) => {
                        const isActive = !!(active && note.id === active.id);
                        const title = noteTitle(note.content) || t('untitled');
                        return h(
                          'div',
                          {
                            key: note.id,
                            className: 'dsh-notes-item' + (isActive ? ' is-active' : ''),
                            role: 'button',
                            tabIndex: 0,
                            'aria-current': isActive ? 'true' : undefined,
                            onClick: () => selectNote(note.id),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                selectNote(note.id);
                              }
                            },
                          },
                          h(
                            'div',
                            { className: 'dsh-notes-item-main' },
                            h('div', { className: 'dsh-notes-item-title' }, title),
                            h('div', { className: 'dsh-notes-item-time' }, formatTime(note.updatedAt)),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className:
                                'dsh-notes-item-remove' +
                                (pendingRemove === note.id ? ' is-pending' : ''),
                              title: pendingRemove === note.id ? t('removeConfirm') : t('remove'),
                              'aria-label': t('remove'),
                              onClick: (event) => {
                                event.stopPropagation();
                                removeNote(note.id);
                              },
                            },
                            h(TrashIcon),
                          ),
                        );
                      }),
                ),
              )
            : null,
          h('section', { className: 'dsh-notes-main' }, renderMain()),
        ),
        h(
          'footer',
          { className: 'dsh-notes-status' },
          h('span', null, charCount + ' ' + t('wordCount')),
          h('span', null, saveFailedRef.current ? '' : t('saved') + (active ? ' · ' + formatTime(active.updatedAt) : '')),
        ),
      );
    };

    /* ---------------------------------------------------------------- 样式 */

    const CSS = `
      .dsh-notes-root {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 1.6;
      }
      /* 右侧栏标签页内没有主面板顶部的框架栏，不需要额外顶部留白 */
      .dsh-notes-root.is-tab {
        padding-top: 0;
      }
      .dsh-notes-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex: none;
        padding: 8px 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-notes-titlebar,
      .dsh-notes-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .dsh-notes-brand {
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }
      .dsh-notes-iconbtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-notes-iconbtn:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-segmented {
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        border-radius: 7px;
        background: var(--dsw-alias-bg-layer-2);
      }
      .dsh-notes-seg {
        padding: 3px 10px;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        white-space: nowrap;
      }
      .dsh-notes-seg:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-seg.is-active {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .dsh-notes-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 7px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        white-space: nowrap;
      }
      .dsh-notes-btn:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dsh-notes-body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .dsh-notes-sidebar {
        display: flex;
        flex-direction: column;
        flex: none;
        width: 208px;
        min-height: 0;
        border-right: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-notes-listhead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex: none;
        padding: 10px 14px 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-notes-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--dsw-alias-bg-layer-2);
        font-size: 11px;
        font-weight: 400;
      }
      .dsh-notes-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 4px 8px 12px;
      }
      .dsh-notes-item {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
        outline: none;
      }
      .dsh-notes-item:hover,
      .dsh-notes-item:focus-visible {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dsh-notes-item.is-active {
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dsh-notes-item-main {
        flex: 1;
        min-width: 0;
      }
      .dsh-notes-item-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-item.is-active .dsh-notes-item-title {
        font-weight: 600;
      }
      .dsh-notes-item-time {
        margin-top: 1px;
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-notes-item-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        opacity: 0;
      }
      .dsh-notes-item:hover .dsh-notes-item-remove,
      .dsh-notes-item.is-active .dsh-notes-item-remove,
      .dsh-notes-item-remove:focus-visible {
        opacity: 1;
      }
      .dsh-notes-item-remove:hover {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-notes-item-remove.is-pending {
        opacity: 1;
        color: var(--dsw-alias-state-error-primary);
      }
      .dsh-notes-list-empty {
        padding: 16px 10px;
        font-size: 12px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-notes-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
      }
      .dsh-notes-editor {
        flex: 1;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 18px 22px;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 13px;
        line-height: 1.7;
        caret-color: var(--dsw-alias-brand-primary);
        tab-size: 2;
      }
      .dsh-notes-editor::placeholder {
        color: var(--dsw-alias-label-tertiary);
      }
      /* ---------- Markdown 格式工具栏 ---------- */
      .dsh-notes-mdbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        flex: none;
        padding: 4px 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-notes-mdbtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 26px;
        height: 24px;
        padding: 0 5px;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .dsh-notes-mdbtn:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-mdbtn.is-strong { font-weight: 700; }
      .dsh-notes-mdbtn.is-italic { font-style: italic; }
      .dsh-notes-mdbtn.is-strike { text-decoration: line-through; }
      .dsh-notes-mdbtn.is-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      /* 会话标题栏里的入口按钮 */
      .dsh-notes-headerbtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-notes-headerbtn:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-split {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
        flex: 1;
        min-height: 0;
      }
      .dsh-notes-split .dsh-notes-editor {
        border-right: none;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .dsh-notes-preview,
      .dsh-notes-preview-solo {
        min-height: 0;
        overflow: auto;
        background: var(--dsw-alias-bg-base);
      }
      .dsh-notes-preview {
        padding: 16px 20px;
      }
      .dsh-notes-preview-solo {
        flex: 1;
        padding: 22px 26px;
      }
      .dsh-notes-placeholder {
        color: var(--dsw-alias-label-tertiary);
      }
      .dsh-notes-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex: 1;
        padding: 40px 24px;
        text-align: center;
      }
      .dsh-notes-empty-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-empty-hint {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-notes-empty .dsh-notes-btn {
        margin-top: 6px;
      }
      .dsh-notes-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex: none;
        padding: 6px 16px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary);
        font-variant-numeric: tabular-nums;
      }
      /* ---------- Markdown 预览 ---------- */
      .dsh-notes-md {
        font-size: 13px;
        line-height: 1.75;
        overflow-wrap: anywhere;
      }
      .dsh-notes-md > *:first-child {
        margin-top: 0;
      }
      .dsh-notes-md > *:last-child {
        margin-bottom: 0;
      }
      .dsh-notes-md .dsh-notes-heading {
        margin: 20px 0 8px;
        line-height: 1.4;
        font-weight: 700;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-md h1.dsh-notes-heading { font-size: 21px; }
      .dsh-notes-md h2.dsh-notes-heading { font-size: 18px; }
      .dsh-notes-md h3.dsh-notes-heading { font-size: 15px; }
      .dsh-notes-md h4.dsh-notes-heading,
      .dsh-notes-md h5.dsh-notes-heading,
      .dsh-notes-md h6.dsh-notes-heading { font-size: 13px; }
      .dsh-notes-md .dsh-notes-p {
        margin: 8px 0;
      }
      .dsh-notes-md .dsh-notes-listblock {
        margin: 8px 0;
      }
      .dsh-notes-md .dsh-notes-list {
        margin: 4px 0;
        padding-left: 22px;
      }
      .dsh-notes-md .dsh-notes-li {
        margin: 3px 0;
      }
      .dsh-notes-md .dsh-notes-li-task {
        list-style: none;
        margin-left: -20px;
      }
      .dsh-notes-md .dsh-notes-check {
        margin: 0 6px 0 0;
        accent-color: var(--dsw-alias-brand-primary);
        vertical-align: -1px;
      }
      .dsh-notes-md .dsh-notes-quote {
        margin: 10px 0;
        padding: 2px 14px;
        border-left: 3px solid var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-notes-md .dsh-notes-hr {
        height: 1px;
        margin: 18px 0;
        border: none;
        background: var(--dsw-alias-border-l1);
      }
      .dsh-notes-md .dsh-notes-link {
        color: var(--dsw-alias-brand-primary);
        text-decoration: none;
      }
      .dsh-notes-md .dsh-notes-link:hover {
        text-decoration: underline;
      }
      .dsh-notes-md .dsh-notes-inline-code {
        padding: 1px 5px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 4px;
        background: var(--dsw-alias-bg-layer-1);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
      }
      .dsh-notes-md .dsh-notes-pre {
        margin: 10px 0;
        padding: 12px 14px;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-notes-md .dsh-notes-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        line-height: 1.65;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-notes-md .dsh-notes-table-wrap {
        margin: 10px 0;
        overflow: auto;
      }
      .dsh-notes-md .dsh-notes-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .dsh-notes-md .dsh-notes-table th,
      .dsh-notes-md .dsh-notes-table td {
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        text-align: left;
        vertical-align: top;
      }
      .dsh-notes-md .dsh-notes-table th {
        background: var(--dsw-alias-bg-layer-1);
        font-weight: 600;
      }
      .dsh-notes-md .dsh-notes-img {
        max-width: 100%;
        border-radius: 6px;
      }
      .dsh-notes-md strong {
        font-weight: 600;
      }
      .dsh-notes-md del {
        color: var(--dsw-alias-label-tertiary);
      }
    `;

    /* ------------------------------------------------------------ 插件注册 */

    /**
     * 注入插件样式。
     * 宿主为动态 Client 插件提供全局内置 `styles.insert(css)`（见 Builtin 契约），
     * 返回的清理函数会随插件卸载执行；若宿主未提供该内置，则退化为原生
     * <style> 标签，卸载时移除，不依赖任何宿主私有 API。
     */
    const insertNotesStyles = () => {
      if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') {
        return styles.insert(CSS);
      }
      const tag = document.createElement('style');
      tag.dataset.dshSidebarNotes = '1';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    };

    /** 会话标题栏入口按钮：点击把记事本打开到右侧栏（无右侧栏时退回主面板）。 */
    const NotesHeaderAction = ({ t, ctx }) => {
      const open = () => {
        const better = ctx.get('betterSidebar');
        if (better && typeof better.openTab === 'function') {
          better.openTab({ type: TAB_ID });
          return;
        }
        const right = ctx.get('sidebarRight');
        if (right && typeof right.openTab === 'function') {
          right.openTab(TAB_ID);
          return;
        }
        const layout = ctx.get('layout');
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID);
      };
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-notes-headerbtn',
          title: t('openInSidebar'),
          'aria-label': t('openInSidebar'),
          onClick: open,
        },
        h(NotesIcon, { size: 16 }),
      );
    };

    function apply(ctx) {
      ctx.effect(insertNotesStyles, 'sidebar-notes: styles');
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-notes: dictionaries');

      const t = ctx.locale.bind(NS);

      // 首选：注册为 dsh-better-sidebar 的右侧栏标签页，与聊天区并排，不遮挡对话。
      const mountSidebarTab = () => {
        const better = ctx.get('betterSidebar');
        if (!better || typeof better.registerTab !== 'function') return false;
        ctx.effect(
          () =>
            better.registerTab({
              id: TAB_ID,
              title: () => t('nav'),
              description: () => t('sidebarDescription'),
              icon: (size) => h(NotesIcon, { size: size || 16 }),
              order: 5,
              single: true,
              component: () => h(NotesPanel, { t, variant: 'tab' }),
            }),
          'sidebar-notes: sidebar tab',
        );
        return true;
      };

      // better-sidebar 可能比本插件晚就绪，服务出现后再补挂标签页。
      if (!mountSidebarTab()) {
        const off = ctx.on('internal/service', (serviceName) => {
          if (serviceName !== 'betterSidebar') return;
          off();
          mountSidebarTab();
        });
      }

      // 回退：没有 dsh-better-sidebar 时，沿用左侧图标 + 主面板的旧布局。
      if (!ctx.get('betterSidebar')) {
        ctx.slots.inject('sidebar.panellist', () => {
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            (ownerProps) =>
              h(NotesPanel, { t: (ownerProps && ownerProps.t) || t, variant: 'panel' }),
          );

          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('nav'),
              locale: NS,
            },
            (owner = {}) =>
              h(NotesIcon, {
                size: owner.size || 16,
                active: owner.active === true,
              }),
          );
        });
      }

      // 会话标题栏入口按钮：聊天页随时一键打开右侧栏记事本。
      ctx.slots.inject('conversation.session.header.actions', () => {
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: TAB_ID,
            order: 20,
            label: () => t('openInSidebar'),
          },
          () => h(NotesHeaderAction, { t, ctx }),
        );
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
