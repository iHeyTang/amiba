# 对话正文扩展

渲染配置直接使用 Streamdown 原生类型。`MarkdownExtension` 从 `StreamdownProps` 选取 `components`、`plugins`、`remarkPlugins`、`rehypePlugins`、`allowedTags`、`literalTagContent`，加上插件注册所需的元数据。没有独立的 `fences`、`renderDefault`、`renderWhileStreaming` 或自定义 code props。

## 编写渲染

```tsx
import type { CustomRendererProps, StreamdownProps } from "streamdown";

function Chart({ code, language, meta, isIncomplete }: CustomRendererProps) {
  if (isIncomplete) return <pre>{code}</pre>;
  return <ChartView data={JSON.parse(code)} />;
}

const rendering = {
  plugins: { renderers: [{ language: ["chart", "plot"], component: Chart }] },
} satisfies Pick<StreamdownProps, "plugins">;
```

这份配置既可以直接传给 `<Streamdown {...rendering} />`，也可以加上 `id`、`version` 后注册为贡献。完整 client 示例见 [markdown-progress-plugin.tsx](examples/markdown-progress-plugin.tsx)。

- 特殊围栏使用原生 `plugins.renderers`，接收原生 `CustomRendererProps`。Streamdown 决定何时调用；renderer 用 `isIncomplete` 自行决定展示半成品、占位还是完整结果。
- 节点覆盖使用原生 `components`，包括 `code`、`pre`、`table`；参数保持 Streamdown 的 `children`、`node` 等契约。显式覆盖 `code` 会接管该节点，包括原生特殊语言分发，这与直接使用 Streamdown 一致。
- 高亮、数学、Mermaid、CJK 使用原生 `plugins.code/math/mermaid/cjk`。
- 解析和自定义标签使用原生 `remarkPlugins`、`rehypePlugins`、`allowedTags`、`literalTagContent`。贡献的 remark 插件接在默认链后，rehype 插件接在默认链前；保留默认 GFM 和 HTML 处理。

## 插件注册与组合

UI Shell 拥有 `amiba.markdown.extension`（root/list）slot，读取注册项的 `inject().extension`。通过现有 `ctx.slots.inject/register` 注册，disposer 或插件禁用会撤销贡献。SDK 导出 `MarkdownExtension` 类型。

以下是宿主集成信息，不是另一套渲染 API：

- `id` / `version`：贡献标识和版本；变更后重建错误边界。
- `order`：多个贡献合并时的优先级，数值越小优先，相同时按 id 排序。同一节点、原生插件类别或语言采用第一个贡献；语言数组按每个语言分别解决冲突。贡献优先于调用处的默认配置。
渲染扩展没有 `instructions` 字段。用途和语法说明由原生 Skills 管理。

渲染组件可以照常从 `streamdown` 导入 hooks。客户端构建必须与 UI Shell 共享 Streamdown 实例，避免 React Context 分裂：将 `streamdown` 标记为 external，并把输出路径映射到 `@amiba/dsh-plugin-ui-shell/client`（UI Shell 重新导出原生 API）。同时声明 UI Shell 的客户端依赖。可参考默认插件的 `vite.config.ts`；源代码无需改成私有 hooks。

## 默认展示与容错

- `@amiba/markdown` 负责贡献合并、报告和错误边界；语法与代码分发由 Streamdown 负责。
- `@amiba/ui/plugin` 提供 `MarkdownCodeView`、`MarkdownTableView` 基础展示组件。
- `@amiba/dsh-plugin-markdown` 通过原生 `components.pre/table` 提供默认展示，order 为 1000。普通代码保留复制和换行；特殊 renderer 不显示普通代码操作。默认插件可以禁用或覆盖。

宿主为特殊 renderer 提供错误边界，抛错时显示原文；节点组件或解析链失败时整段退回普通 Streamdown。事件处理器和异步任务仍由插件自行处理错误。没有匹配 renderer 时使用 Streamdown 默认代码展示。

## Agent 能力配套：复用原生 Skills

插件可以同时提供 renderer 和任意用途的 Skills。所有 Skills 都通过原生 `ctx.skills` 注册；摘要发现和正文按需读取沿用现有机制，没有 Markdown 专用加载工具，也没有额外的语法提示词注入。

**只有明确依赖 renderer 的 Skill 才需要可选关联。** 搜索、分析、文件处理等普通 Skill 不受渲染能力影响。同一个 provider 可以混合提供两类 Skill。

对于确实依赖渲染的条目，在注册原生 provider 时使用宿主导出的 `withMarkdownCapability(ctx, requirements, provider, control)`：`requirements` 按 Skill 名称指定 renderer 贡献 id、版本和所需语言，未列出的 Skill 原样保留。完整 host 示例见 [markdown-progress-host.ts](examples/markdown-progress-host.ts)，对应客户端见 [markdown-progress-plugin.tsx](examples/markdown-progress-plugin.tsx)。关联只属于 host 注册，Streamdown 渲染配置不增加 Skill 字段。插件 host 声明 `skills` 和 `markdownCapabilities` 注入依赖。

UI Shell 的 `amibaMarkdown/report` 只上报当前会话的 renderer id、版本和实际生效的语言，不接受语法说明。提交消息前等待报告完成；注册表变化后刷新最近提交的会话。关联适配器在原生 provider 的 list/get 处检查能力，读取正文后也复查，避免加载期间 renderer 已撤销。

能力报告按会话保存，10 分钟过期；更新和过期均使原生 Skills 目录缓存失效。缺少有效报告、版本或语言不匹配时，仅隐藏关联条目。没有活跃 agent 会话的全局/预设目录也不展示关联条目；普通 Skills 照常展示。多窗口仍采用同一会话最后一次报告。

这不会撤回已经进入历史上下文的 Skill 正文，也不保证模型遗忘之前加载的语法；无匹配 renderer 时界面继续显示可读代码。

## 验证与运行

默认插件已加入 Web bundle。新增插件或 host Remote 后需要重建并重启开发运行时。

UI 的 `markdown-extensions.test.tsx` 验证同一配置直接传给 Streamdown 和经贡献注册后的节点参数、语言别名、meta、流式 props/hooks 一致；另覆盖优先级、禁用和错误回退。`markdown-code.test.tsx` 验证默认操作。UI Shell 的 source/capabilities 测试验证注册和会话报告。
