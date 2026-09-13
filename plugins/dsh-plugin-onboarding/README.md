# Amiba 入门引导

独立的首次启动引导插件。由 `dsh-bundle-amiba-core` 默认装配，Host 只依赖 DSH
`settings`，不在 desktop core、app-runtime 或 UI shell 中接入具体业务插件。

- 使用标准 `settings.onboarding` 在首页/空白会话触发；可见向导通过 `shell.overlay`
  呈现，因此设置中的「入门引导」也能重新打开同一流程。
- `amiba-onboarding` 设置命名空间持久化已处理步骤、跳过步骤及整个流程完成状态。
  完成后不再自动弹出；「稍后继续」保留进度，本次客户端运行中不重复弹出，重启可继续。
  读取或保存失败时可重试，不把错误当作完成。
- 模型插件注册 `models` 步骤，推荐 **TokenDance（Amiba 推荐）** 与
  **DeepSeek（DSH 官方）**。它复用 DSH 原生 provider 配置、凭据及默认模型接口。
  流程分为「选择服务 → 获取并填写 Key → 选择模型」三页。主操作统一放在右下角，
  「上一步」在主操作左侧，「稍后继续」在左下角。
  尚未声明的 TokenDance profile 在选择服务后点「下一步」时初始化；凭据未配置、
  provider 不可用或没有启用模型时不能继续。选择默认模型并成功保存后才完成步骤。
  Key 页仅显示获取教程和密码输入框，已有 Key 可留空沿用；保存成功后清空输入，
  切换服务也清空未保存的 Key。不复制用户的个人密钥，也不通过模型请求验证余额或权限。
  官方获取入口：[TokenDance API 密钥](https://tokendance.space/keys)、
  [DeepSeek API Keys](https://platform.deepseek.com/api_keys)。
  操作说明依据 [TokenDance 密钥文档](https://tokendance.space/docs/api-keys) 和
  [DeepSeek 首次调用文档](https://api-docs.deepseek.com/zh-cn/)。
- 宠物插件注册向导角色：使用当前宠物；新用户宠物库为空时预览内置 Mofli，
  不向宠物库写入默认数据。欢迎、等待、保存、完成和错误有对应对话与表情。

## 扩展步骤

引导插件在自己的 overlay 注册中唯一声明两个子插槽：

- `amiba.onboarding.step`：root/list。以稳定 `id` 标识步骤，按 `order` 排序。
  每次只渲染第一个未处理步骤。步骤可在加载/卸载时动态变化。
  `renderActions(ReactNode)` 通过 portal 把步骤导航渲染到公共页脚右侧；正文表单可用 `form` id 与页脚提交按钮关联。
  正文独立滚动，页脚始终可见。只有多个扩展步骤时显示总进度和次要的跳过入口，避免与步骤内部进度重复。
- `amiba.onboarding.companion`：root/single。宠物或其他角色通过 `mood` 响应状态。

接入方可以声明本插件为 optional peer，并通过 `/client` 的 type-only import
加载插槽类型；在 `slots.inject` 内注册，因此关闭引导插件不会阻塞接入方原有功能。
引导插件本身不依赖模型插件或宠物插件。

```tsx
import type { GuideStepOwner } from '@amiba/dsh-plugin-onboarding/client';

function Setup({ complete, say, openSection, renderActions }: GuideStepOwner) {
  // 完成业务配置后 await complete()；失败时保留本步骤供用户重试。
  // say('现在连接你的服务吧', 'waiting') 可以让宠物提供简短提示。
  // openSection('your-settings') 关闭向导并转到已有设置页面，保留当前进度。
  // 主操作通过 renderActions 放入公共页脚，保持步骤间的位置一致。
  return renderActions(<button onClick={() => openSection('your-settings')}>下一步</button>);
}
ctx.slots.inject('amiba.onboarding.step', () => ctx.slots.register({
  name: 'amiba.onboarding.step', id: 'your-plugin.connection.v1', order: 20,
  label: () => '连接服务',
}, Setup));
```

步骤 id 是持久化键；不兼容的新引导可以使用新 id。完成过整套引导的用户不会
因新插件加入而被打断，可以从设置中重访所有当前步骤。跳过步骤会明确提示仍有待配置内容。
用户所有 provider、凭据操作仍由其所属插件处理；引导进度中只保存步骤 id 和布尔状态。

## 验证与独立预览

在仓库安装依赖后，先构建 ui-shell、notification-hub，再构建 onboarding、model-plane、pets。

```sh
pnpm --filter @amiba/dsh-plugin-onboarding build
pnpm --filter @amiba/dsh-plugin-onboarding test
pnpm --filter @amiba/dsh-plugin-model-plane test
node scripts/verify-dsh-architecture.mjs
node scripts/verify-pluginization.mjs
node plugins/dsh-plugin-onboarding/scripts/preview.mjs
```

预览地址由脚本输出（默认 `127.0.0.1:5198`）。它使用实际 React 界面、凭据表单和
宠物渲染器，但所有业务操作均为内存模拟，不连接 DSH、不保存真实凭据、不影响现有桌面任务。
