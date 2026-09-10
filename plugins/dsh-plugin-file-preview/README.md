# 文件预览工作台插件

`@amiba/dsh-plugin-file-preview` 在 `amiba.workbench.view` 中注册 `file` 和 `files` 视图，并提供文件导航入口。它负责文件读取、刷新、错误反馈、预览器选择和图片对象 URL 的释放。文本与图片预览器都内置在本插件中，图片没有单独的插件包。

工作台宿主负责布局、会话隔离和标签页生命周期。文件列表、路径操作、代码编辑器等展示组件复用 UI Shell 的公开组件；插件通过 UI Shell 的导出使用同一份 React Context。Electron 继续负责实际文件访问与原有路径校验。

## 扩展文件类型

本插件声明 `amiba.filePreview.renderer`，其他 DSH 插件可以注册：

```tsx
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { FilePreviewRenderer, FilePreviewProps } from "@amiba/dsh-plugin-file-preview/client";

function CsvPreview({ document }: FilePreviewProps) {
  return <pre>{document.content}</pre>; // 可替换为 CSV 表格组件
}
const renderer: FilePreviewRenderer = {
  id: "example.csv",
  order: 0,
  extensions: ["csv"],
  mimeTypes: ["text/csv"],
  component: CsvPreview,
};
export function apply(ctx: ClientContext) {
  return ctx.slots.inject("amiba.filePreview.renderer", () =>
    ctx.slots.register({
      name: "amiba.filePreview.renderer",
      id: renderer.id,
      order: renderer.order,
      inject: () => ({ renderer }),
    }, () => null),
  );
}
```

- 扩展名不区分大小写，可带 `.`；MIME 支持 `image/*` 这样的通配。
- 匹配条件取并集。较小的 `order` 优先，同序号按 `id` 排序。内置图片为 100，文本回退为 1000。
- 二进制预览器使用 `readBytes()` 获取完整 Base64 内容；文本使用 `document.content`，并注意 `document.truncated`。
- Electron 文本预览最多读取 2 MiB，完整二进制读取最多 32 MiB，超限报错而不传递截断图片。
- 注册返回的 disposer 必须随插件清理。安装、卸载后会重新选择预览器；没有匹配项时显示不可预览提示。
- 渲染异常由预览边界隔离，异步操作的错误由预览器自行显示。插件仍属于受信任的同进程代码，错误边界不是代码沙箱。
- 图片内置支持 PNG、JPEG、GIF、WebP、BMP、SVG、ICO、AVIF，实际解码能力取决于宿主浏览器。SVG 以 `<img>` 展示，不注入 HTML。

## 验证

运行 `pnpm test`、`pnpm typecheck` 和 `pnpm build`。测试包含真实 DSH SlotCore 注册/释放、文件切换竞态、预览器替换、图片错误及 URL 清理。桌面二进制读取测试位于 `apps/desktop/src/main/__tests__/file-preview.test.mjs`。
