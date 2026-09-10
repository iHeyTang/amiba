# 工作台与文件预览的两层扩展

工作台现在通过 `amiba.workbench.view` 接收资源视图贡献。文件预览插件通过该协议注册，再声明自己的 `amiba.filePreview.renderer` 插槽。两层都使用 DSH 的贡献记录和销毁机制，不维护额外的全局注册表。

```text
UI Shell / 工作台宿主
  └─ amiba.workbench.view
      ├─ file、files → dsh-plugin-file-preview
      │   └─ amiba.filePreview.renderer
      │       ├─ 内置文本、图片
      │       └─ 其他插件注册的文件类型
      ├─ code、diff、checkpoints → Shell 内置贡献
      ├─ browser → Shell 内置贡献 / Electron 浏览器表面
      └─ 任意插件资源类型
```

## 注册工作台资源视图

SDK 提供 `WorkbenchResource`、`WorkbenchViewProps`、`WorkbenchViewExtension`。资源使用开放的 `type` 标识，不需要扩充宿主的联合类型或渲染条件。

```tsx
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { WorkbenchViewExtension, WorkbenchViewProps } from "@amiba/extension-sdk";

function ChartView({ resource, sessionId, openResource }: WorkbenchViewProps) {
  return <div>{resource.title}</div>;
}
const extension: WorkbenchViewExtension = {
  id: "example.chart",
  resourceType: "example.chart",
  order: 0,
  component: ChartView,
  // 可选：工作台固定导航入口。标签按当前语言求值。
  launcher: { label: () => "图表" },
};
export function apply(ctx: ClientContext) {
  return ctx.slots.inject("amiba.workbench.view", () =>
    ctx.slots.register({
      name: "amiba.workbench.view",
      id: extension.id,
      order: extension.order,
      inject: () => ({ extension }),
    }, () => null),
  );
}
```

视图收到 `sessionId`、`openFile()` 和 `openResource()`。已有 `amiba.workbench.panel` 面板也可通过 owner 的 `openResource()` 打开标签：

```ts
openResource({
  type: "example.chart",
  id: "sales-2026",
  title: "销售图表",
  data: { year: 2026 },
});
```

同一会话内相同 `type + id` 复用标签，不同会话分别保存。视图应验证自己的 `data`；导航入口没有业务数据，需能处理 `data` 缺失。资源标签仍可在扩展卸载后保留，内容显示不可用提示；重新启用扩展后可恢复。工作台不要求文件系统能力才能打开插件资源。

同一资源类型允许多个贡献，较小 `order` 优先，同序号按 `id` 排序。渲染器以 React 组件形式挂载，拥有正常的 hooks 和卸载生命周期；渲染错误局限于该视图。

## 兼容与宿主职责

原有文件、工具执行、Diff、浏览器事件在宿主入口转换为开放资源协议。已有 `amiba.workbench.panel` 保持兼容。旧 `files` / `checkpoints` 模式保留为状态适配，新的导航入口使用 `view:<resourceType>`。

布局、标签页、会话隔离、终端与 Electron 浏览器表面的跨会话生命周期仍由宿主处理。现有内置资源展示也注册到同一贡献记录中；文件内容读取及预览器选择已移出 `WorkspacePane`。文件布局和代码编辑器是共享 UI 组件，不会自行注册或读取文件内容。

文件类型扩展示例与二进制接口限制见 `plugins/dsh-plugin-file-preview/README.md`。
