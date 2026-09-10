# MCP 完整落实验收记录

2026-09-07。按连接、授权、使用方的产品设计完成实现及尾项验证，不采用运行实例开关作为用户交互。

## 要求与证据

| 要求 | 实现与验证 |
| --- | --- |
| 一份连接配置供多个插件使用，凭据不重复存储 | provider-owned connection + useMcpRequirement；access.test.ts 验证批准文件无私有凭据 |
| 默认独立，双方声明且同连接、精确版本时共享 | dependencies.test.ts 验证默认隔离、显式共享、不同连接隔离、版本及所有权冲突 |
| 共享不合并权限 | tool-surface.test.ts 与 dependency-runtime.test.ts 使用正式 ToolRuntime 和真实 MCP 进程验证各插件确切工具清单、全局曝光不扩大私有范围、在途撤销 |
| 插件不重新实现 MCP 客户端 | supervisor.ts 统一挂载官方 DSH MCP Client，在 Cordis 私有 tools 服务登记，再向批准作用域投影 |
| 插件声明需求，用户选择账号并批准能力 | useMcpRequirement + access.json；过期页面提交、换账号、扩大能力及版本变化均需重新批准 |
| 消费者、提供者和 Manager 任意加载顺序 | binding/provider/plugin 生命周期测试覆盖晚加载、卸载、Manager 重载及同身份自动恢复 |
| 单独撤销一个插件不重启其他使用方 | 真实进程 PID 验证；普通智能体独立批准和撤销 |
| 名称修改不重启连接 | metadata 更新与失败回滚测试；真实进程 PID 保持不变 |
| 凭据更新安全恢复 | 更新先撤销旧租约，同身份恢复、不同身份阻断；正式凭据存储下更新通过 smoke |
| 停用批准可见且可撤销 | access.list 投影 inactive 批准；UI 测试及实际组件预览验证 |
| 删除连接清理授权 | 配置归属钩子 forgetConfiguration；Manager 重载时在批准队列内读取最新配置清单，避免过期快照误删；失败保留连接并允许重试 |
| 永久移除使用方的清理 | forgetOwner 测试验证其他使用方不受影响、重装需新批准；当前官方清单为只读，项目无插件包卸载 UI，运行时 dispose 保留可见批准供恢复或人工撤销 |
| 功能启动失败可见、可恢复 | 区分连接失败与功能安装失败，失败清理部分资源，retryAccess 沿用批准；真实 Cordis 测试及 UI 重试检查 |
| 连接详情展示能力和使用方 | 通用 amiba.connection.access 插槽；停用/删除前刷新影响清单，新增授权立即进入影响范围 |
| 飞书/钉钉没有旧 MCP 开关 | 删除 mcpEnabled/enableTools；分别声明固定发布包的 10/19 项工具，机器人消息继续走 SDK |
| 预设与场景扩展分离 | 官方四个预设保持；移除 restricted/steward 预设种子；大管家使用 session features，预设与功能测试通过 |
| 未发版不实现旧数据迁移 | 不新增旧数据转换；docs/data-upgrades.md 为 core 与插件的统一升级设计约定，明确尚无执行器/SDK |

## 验证结果

- MCP Manager：49 项测试；包含正式产品批准 + provider helper + 官方 ToolRuntime/Client + 真实 stdio 进程的联合测试。
- connector-core：174 项测试；包含严格 JSON 凭据回归、配置修改、元数据回滚、删除清理及影响确认。
- 飞书 136 项，钉钉 116 项，预设 26 项，大管家 78 项，session features 5 项，工具目录 11 项。
- 官方工具展示相关 44 项；浏览器模块 1 项；修改模块类型检查及构建通过。
- 实际 ConnectAccountPage/McpAccessPanel 使用产品 Tailwind 样式在本地浏览器预览，检查中文排版、账号选择批准、重试、停用与删除影响。使用内存 adapter；真实后端由集成测试覆盖，未操作用户账号。
- verify:architecture 通过。字典已放入约定文件；静态 fallback 检查与现有官方语义包装对齐。
- verify:pluginization 通过。
- runtime:prepare、runtime:verify、runtime:smoke 全部通过。smoke 覆盖正式 profile 安装/移除、插件装配、会话/预设/配置、连接私有配置更新、MCP 远程接口及官方子插件重载。

上述阶段运行证据：/tmp/mcp-credential-runtime-prepare.log、/tmp/mcp-credential-runtime-verify.log、/tmp/mcp-credential-runtime-smoke.log。当时未重启应用，组件预览和后端 smoke 未覆盖真实 Electron 启动，随后用户发现了客户端模块加载回归。

### 桌面启动回归补充验收

- 工具目录实际导入 UI Shell 的客户端模块，但清单缺少 `dsh.client.external` 声明；已补齐。`inject` 表示插件注入依赖，不能替代模块到达依赖。
- Electron 启动图转换丢弃了官方图中的 `external` 字段；现保留并校验该字段，renderer 类型同步更新。
- 启动转换测试 8 项通过，覆盖 `external` 与 `inject` 分别保留以及非法字段拒绝；桌面类型检查通过。
- 运行包 prepare、verify、smoke 通过；smoke 增加编译产物中的 Amiba 模块导入与 external 声明一致性检查。此检查仍不能替代真实 renderer 启动验收。
- 已重启真实 Electron 开发实例，实际检查工作台以及「设置 → 工具」页面均正常加载，启动日志无上述模块加载错误。保持修复后的应用运行。
- 本次证据：/tmp/amiba-boot-regression-tests.log、/tmp/amiba-boot-fix-types.log、/tmp/amiba-boot-fix-prepare.log、/tmp/amiba-boot-fix-verify.log、/tmp/amiba-boot-fix-smoke.log、/tmp/amiba-boot-fixed-desktop.log。

## 约定与资料

最终接口与产品行为见 mcp-dependencies.md；升级设计见 data-upgrades.md。未运行真实飞书/钉钉 MCP 服务，未写入用户连接配置。

固定发布包资料在 /tmp/amiba-mcp-package-review：larksuiteoapi-lark-mcp-0.5.1.tgz 与 dingtalk-mcp-1.1.21.tgz。飞书工具来自 preset.light；钉钉工具来自 contacts/calendar/tasks，均包含写入能力。协议与连接由 DSH MCP Client 0.1.1-rc.2 负责。

临时组件预览在 /tmp/amiba-mcp-ui-qa，预览服务和标签已关闭；隔离 smoke 环境已清理。
