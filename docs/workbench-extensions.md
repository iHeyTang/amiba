# 工作台与文件预览的两层扩展

工作台现在通过 `amiba.workbench.view` 接收资源视图贡献。文件预览插件通过该协议注册，再声明自己的 `amiba.filePreview.renderer` 插槽。两层都使用 DSH 的贡献记录和销毁机制，不维护额外的全局注册表。

```text
UI Shell / 会话与平台上下文
  └─ amiba.workbench.shell → dsh-plugin-workbench
      （单一展开按钮、空态、标签、＋菜单）
  └─ amiba.workbench.view
      ├─ file、files → dsh-plugin-file-preview
      │   └─ amiba.filePreview.renderer
      │       ├─ 内置文本、图片
      │       └─ 其他插件注册的文件类型
      ├─ code、diff、checkpoints → 工作台插件安装的共享视图
      ├─ terminal → dsh-plugin-terminal
      ├─ browser → 可独立安装的 dsh-plugin-browser-provider-electron
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
  // 可选：空态与新建标签菜单共用的入口，标签按当前语言求值。
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

原有文件、工具执行、Diff 事件在宿主入口转换为开放资源协议；浏览器事件由浏览器插件自身转换。已有 `amiba.workbench.panel` 保持兼容。旧 `files` / `checkpoints` 模式保留为状态适配，新的导航入口使用 `view:<resourceType>`。

工作台插件安装布局、标签页和空态，宿主保留会话隔离与平台适配。终端视图、xterm 依赖和进程关闭逻辑由终端插件负责。浏览器表面的跨会话生命周期归浏览器插件所有。现有内置资源展示也注册到同一贡献记录中；文件内容读取及预览器选择已移出 `WorkspacePane`。文件布局和代码编辑器是共享 UI 组件，不会自行注册或读取文件内容。

文件类型扩展示例与二进制接口限制见 `plugins/dsh-plugin-file-preview/README.md`。

## 常驻插件与原生扩展

`WorkbenchViewExtension.host` 是与聊天树并列的常驻组件，可以处理后台会话资源。
`toolbar` 作为旧扩展字段保留，主界面不再渲染独立边缘按钮。`launcher` 提供空态与「＋」入口，`tabIcon` 提供标签图标，`resolveUrl(url, resources)`
处理链接并返回开放资源。所有字段跟随同一资源类型的贡献选举，卸载或替换后同时移除，
不会重新挂载聊天树。插件可以通过闭包共享自身状态，不需要全局注册表。

`useWorkspacePane()` 提供 `resources`（所有会话）、`openResourceIn(sessionId, resource)`、
`updateResourceIn(sessionId, type, id, update)`、`focusResourceIn(sessionId, type, id)`。
操作只影响指定会话；更新不会改变资源身份。`openUrl()` 委托已选中的插件，不存在处理器时返回 false。

桌面原生插件通过 `dsh.native` 声明单文件 CommonJS 入口，契约见 SDK 的
`DesktopExtensionModule`、`DesktopExtensionContext`、`DesktopExtensionBridge`。
主进程只装载已安装依赖图中的入口，实例通道由不复用的 lease 标识；停止 DSH 时强制清理所有实例。
浏览器的安装、卸载、打包与替换方式见 `plugins/dsh-plugin-browser-provider-electron/README.md`。

## 新建标签与关闭生命周期

`launcher` 只随每种资源类型选中的视图出现。空态和最后一个标签右侧的「＋」弹出菜单读取同一贡献记录，没有内置的文件/终端/浏览器名单。

```tsx
launcher: {
  label: () => "打开图表",
  icon: ChartIcon,
  createResource: () => ({ type: "example.chart", id: crypto.randomUUID(), title: "图表" }),
},
onClose: async (resource, sessionId) => {
  await stopResource(sessionId, resource.id);
},
```

省略 `createResource` 时使用资源类型作为 id，适合文件选择器这样的单实例入口。指定新的 id 可打开多个实例。`onClose` 完成后才移除标签，拒绝时保留标签并显示错误；切换标签、切换任务和收起工作台不会触发 `onClose`。

旧 `amiba.workbench.panel` 仍可处理程序请求，但旧侧边栏和后台任务不再创建常驻导航按钮。关闭最后一个资源标签后显示空态，不自动打开文件视图。工作台插件卸载会移除布局和展开按钮；资源视图插件卸载会移除其菜单入口。
