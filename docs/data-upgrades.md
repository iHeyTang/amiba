# Core 与插件统一数据升级约定

状态：设计约定，2026-09-06。尚未实现 coordinator、SDK、CLI 或任何迁移步骤；本文中的接口和目录是未来实现目标。当前产品未正式发版，不维护开发阶段旧数据转换。首次发布前必须完成下文的执行器与存储适配器验收，再冻结首个数据基线。

## 1. 决策与官方边界

统一的是声明、计划、执行、提交、恢复和报错协议；具体转换由数据所有者维护。Core 不集中收录所有插件业务转换，插件也不能在 `apply()`、store 构造函数或页面加载中偷偷执行升级。

项目当前固定的 DSH 是 `0.1.1-rc.2`。核查时官方 master 已提供 `dsh-session-format` 和静态 `dsh-session-format-catalog`，后者包含 v0、v1、v2 及相邻转换，明确不支持外部迁移所有权或运行期插件注册。会话可读性不能取决于启用了哪些功能插件。参见 [官方 catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-format-catalog/README.md)。

官方 JSONL provider 在返回会话 handle 前升级正文，保留旧日志并发布新的格式代次；这不是任意插件文件的升级入口，其跨进程追加隔离也有明确限制。参见 [官方已实施设计](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md)。本项目此次不升级 DSH 依赖，也不复制该日志转换链。

官方 [settings](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/settings/settings/README.md) 提供命名空间、schema 校验和持久化服务边界。在核查的会话格式与 settings 接口中，没有可直接用于所有插件私有数据的通用升级契约；因此以下是 Amiba 自己的约定，不是 DSH 已有 API。

| 数据 | 所有者与升级责任 |
| --- | --- |
| DSH 会话日志、官方持久化格式 | 官方 persistence；Amiba 不直接重写 header、事件或格式版本 |
| Amiba core 私有持久化数据 | core 声明 dataset，通过统一 coordinator 执行 |
| 插件私有文件或数据库 | 插件声明 dataset，通过相同 coordinator 执行 |
| 官方 settings 中插件拥有的 namespace | 转换由插件声明，但提交必须通过支持事务/版本的 settings provider 适配器；禁止整份 YAML 自行重写 |
| 索引、可再生缓存 | 声明为 derived，可在兼容性失败时重建；不能把用户数据标成缓存以绕过升级 |
| 浏览器 IndexedDB / 用户本地偏好 | 需要独立客户端执行器与跨标签页协调，首版宿主执行器不覆盖；没有适配器时禁止宣称已支持 |

## 2. 版本与身份

四种版本互相独立：应用/插件包的 semver 用于代码分发和 API 依赖；dataset 的 `schemaVersion` 用于持久化格式；会话扩展行为版本用于运行组装兼容性；DSH `formatVersion` 由官方维护。仅改 UI 或提示词不要求提升数据版本。

数据身份为 `(ownerId, datasetId, instanceId, canonicalRoot)`。`ownerId` 是稳定包标识，core 也使用固定标识；`instanceId` 区分同一插件的独立实例。显示名称、当前工作目录、插件启用顺序都不能作为身份。多个实例明确共享同一 dataset 时，只注册一次并共同遵守写入租约。

`schemaVersion` 使用正整数。全新数据由当前 initializer 直接创建到当前版本，初始化与版本写入必须一起提交，不伪造 `0 -> 1` 历史迁移。非空数据缺版本是 `unknown-version`，不能当空库或默认 v0。首次正式发布冻结基线；未发版的历史文件不自动识别、删除或转换。

遇到比运行代码更新的版本，拒绝打开写句柄，不降级、不偷偷清空，也不回退到旧备份。校验失败不等于“数据不存在”。

## 3. 统一维护位置与声明

本文是规则的唯一维护入口。未来公共类型、校验器和作者测试工具放在 `packages/data-upgrades/`；宿主 coordinator 放在 `packages/app-runtime/src/data-upgrades/`；各 owner 的定义放在自身 `src/migrations/index.ts`，相邻步骤放在 `src/migrations/vN-to-vN+1.ts`，历史 fixture 与步骤同目录维护。

插件通过独立 `./migrations` package export 发布声明。Core 提供同形状的内部入口。此 export 是 **Amiba 的约定**，不得自行添加一个假定 DSH 会识别的 manifest 字段。未来构建流程从已经解析、校验兼容性的包清单生成 migration inventory；不遍历任意目录执行脚本，也不引入第二套插件发现系统。

inventory 必须在插件正常加载和打开 store 前可获得。独立入口不得调用插件 `apply()`、注册服务、读写用户数据或导入要求新格式的 store；构建校验其 import graph，执行隔离测试。插件是否有 UI、是否来自 IM、是否为内部插件都不影响规则。

以下是拟定契约示意，非可导入 SDK：

```ts
interface DatasetUpgradeDefinition {
  ownerId: string;
  datasetId: string;
  schemaVersion: number;
  storage: "json-generation" | "sqlite" | "settings-namespace";
  kind: "authoritative" | "derived";
  // 对其他 dataset 的最低版本要求；由 inventory 校验依赖环。
  requires: readonly DatasetRequirement[];
  initialize: Initializer;
  steps: readonly UpgradeStep[];
}

interface UpgradeStep {
  from: number;
  to: number; // 必须等于 from + 1
  description: string;
  validateSource: Validator;
  transform: ScopedTransformation;
  validateTarget: Validator;
}
```

`DatasetRequirement` 通过完整 owner/dataset 身份解析；`Initializer`、`Validator`、`ScopedTransformation` 的具体签名由存储适配器提供，不能暴露任意 filesystem 或原始连接。JSON 转换读取不可变快照并输出新快照；SQLite 转换使用受限事务句柄。所有转换禁用外部网络、副作用和时间/随机数生成；需要固定时间或 ID 时由计划生成并记录稳定输入。

构建记录包版本、完整迁移模块依赖闭包的 digest、步骤来源和支持范围。已发布步骤及历史验证器不可修改，不引用会随当前版本变化的业务默认值。每个受支持版本到当前必须有唯一连续相邻链；禁止缺步、跳步、重复边或自动选分支。跨多版本升级按链顺序执行，不能要求用户安装每个中间应用版本。

## 4. 启动和插件升级流程

1. 完成代码包解析与 API 兼容性校验，读取静态 inventory；代码依赖不兼容先拒绝，不通过数据迁移补救。
2. 获取数据 home 的独占写入租约，读取 dataset 元数据，生成只读计划：当前/目标版本、步骤、依赖、备份空间和阻塞原因。
3. 按依赖拓扑升级 core 启动必需数据，再处理将启用插件的数据。禁用插件暂不升级私有数据；日后启用时走同一 gate。缺少已卸载 owner 的代码时保留数据并显示 unavailable，不猜测转换。
4. 对每个 dataset 校验源、准备 checkpoint、转换到隔离 staging、校验目标、原子提交。成功后才向相应插件发放可用的数据句柄。
5. 完成依赖 cohort 后加载插件，发布工具、服务和 UI。升级失败的可选插件保持不可用并暴露原因；core 或共享必需依赖失败则阻止依赖它的启动。不能显示可用但后台以空数据运行。

首版只支持离线升级。已运行插件升级需排空任务、释放句柄并重启进入 gate；不在热重载回调里改库。迁移结束后正常进程继续持有同一 data-home 写入租约，桌面、Web 宿主和 CLI 都必须遵守。只有迁移锁而普通 writer 不受控，不构成隔离。旧进程尚在运行时拒绝升级；不能只根据 PID 超时抢锁。底层采用 OS 进程锁/等效存活租约，进程退出自动释放。

跨 owner 依赖表示版本就绪顺序，不承诺多库原子性。插件不能改另一个插件的私有文件。涉及多 owner 语义变更优先使用 expand/contract：先增加兼容表示，各方升级后再移除旧表示。需要不可分割事务时必须显式设计共享数据所有者或有恢复协议的事务 cohort，通用 dataset API 不假装多个 rename 能组成事务。

## 5. 提交、崩溃恢复和降级

适配器必须把“数据 + schemaVersion + generation/commitId”作为同一个提交单元：

- JSON/多文件：写入完整新 generation，校验并 sync，再原子发布指向该 generation 的 manifest；所有 reader 必须通过 manifest 解析，不能继续读旧固定路径。源 generation 不被就地修改，清理 staging 不影响提交结果。
- SQLite：变更与版本元数据写入同一事务，失败 rollback；checkpoint 通过 SQLite backup API/一致性机制制作，不能直接复制正在写入的 DB/WAL 文件。
- settings namespace：必须先具备 provider 侧带 revision 的原子变更接口，在同一提交中保存 namespace 数据和版本。若官方 provider 不支持，保持该 adapter 未实现；不能在官方 schema 注册之后以不合法旧值先行启动，再补写版本。

统一 journal 记录 planned/staged/committed/failed、输入指纹、目标 commitId 和错误，具体路径由 coordinator 管理。dataset 的原子提交元数据才是事实来源：如果提交成功但 journal 写入前崩溃，重启读取目标 commitId 补齐 journal，不能重做转换。若尚未提交，校验源指纹后丢弃不完整 staging 或从相同稳定输入重算；源变动必须重新规划。

不宣称任意脚本 exactly-once；通过禁止外部副作用和存储原子提交保证已发布结果唯一。磁盘满、断电、源损坏、碰撞、锁被占用均保留可诊断错误与原数据，不自动初始化覆盖。

checkpoint 保留时间/容量由统一策略管理，记录权限且不在日志中输出凭据。备份存在不代表自动支持旧程序：新版本写入后回滚会丢失后续变化。恢复必须在停写状态显式选择 checkpoint，检查代码/数据版本与关联 dataset；无自动 downgrade 链。卸载插件也不自动删除其业务数据或 checkpoint。

## 6. 正式发布前的实现与验收

落地顺序：公共声明与 inventory 校验 → 写入租约和 read-only plan → JSON/SQLite adapters 与 journal 恢复 → core/plugin activation gate → settings adapter（满足 provider 前提后）→ 发布流水线检查。不要先写零散迁移，再让 coordinator 包装这些副作用。

未来运维入口可以提供 `data status / plan / upgrade`，但目前这些命令不存在。状态必须区分新数据、无需升级、待升级、未知版本、未来版本、缺步骤、依赖不可用和执行失败，错误指向 owner/dataset/步骤，不能只报“启动失败”。

每个 owner 发布格式变更必须提交：相邻步骤、冻结源/目标 fixture、变更说明、升级空间估算、支持历史范围。CI 验证从每个已支持基线到当前，以及多步升级与单步顺序的相同结果。未支持的历史范围必须明确拒绝，不能删去旧步骤后悄悄假定所有人已升级。

公共 runner 的验收覆盖：新库初始化、无变化不写盘、缺版本/未来版本、链断裂、修改已发布步骤、校验失败、磁盘满、每个提交边界崩溃、提交成功但 journal 丢失、第二个进程/正常 writer 竞争、重启重试、禁用后跨版本启用、多实例共享数据、依赖失败与可选插件隔离。只有这些通过，才允许首个正式发布的数据迁移接入。

## 7. 本次清理范围

删除预设 seed 的启动归档/引用改写和配套 hash/fixture、steward 旧预设会话换新及 previous ID 留存、旧语言设置复制、旧本地归档/隐藏标记自动写入 DSH。移除相应测试与专用依赖，保留正常行为验证。

未扫描或改写真实用户数据；不修改 vendored DSH 内部格式处理和可重建缓存逻辑。保留当前格式校验、正常初始化、会话扩展行为版本校验，它们不是历史数据迁移实现。
