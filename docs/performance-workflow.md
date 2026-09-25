# Amiba 性能优化工作流

本文件定义 Amiba 前端的性能优化闭环。所有针对会话/界面渲染的性能工作必须按此流程执行，以保持"每轮优化都有指标对比、可回归、可回滚"。

## 核心循环（8 步）

```
扫描挖掘问题 → 确认问题 → 明确指标 → 修复优化 → 本地实测 → 确认指标对比 → 完成优化 → 继续扫描
```

每一步的产出：

| 步骤 | 做什么 | 产出 |
|---|---|---|
| 1 扫描挖掘 | 按「扫描检查清单」逐项核查；使用 `scripts/perf/run.mjs` 对真实会话数据出指标 | 候选问题清单（待确认） |
| 2 确认问题 | 用数据/代码证据确认每个候选项（基准数字、调用路径、频率）；**没有证据的候选不进入修复** | 确认问题清单 + 每项证据 |
| 3 明确指标 | 为每个问题定义可测量指标（见「指标表」）与目标值/阈值；约定实测方法（Tier A/B） | 指标定义（含 before 基线） |
| 4 修复优化 | 在 feature worktree 实现；**视觉不变优先**（本次全局约束：任何改动不得改变当前视觉体验，除非用户明确豁免） | 代码 + 变更说明 |
| 5 本地实测 | 运行 `scripts/perf/run.mjs`、相关 vitest 套件、必要时桌面构建后 DevTools 实测（Tier B） | after 数字 + 测试结果 |
| 6 确认指标对比 | before/after 对比（`run.mjs --compare <before.json> --out <after.json>` 自动输出 Δ% 表；`--fail-over 50` 使超过 ±50% 的劣化以非零退出码失败）；达标（达成目标或解释后接受）才进入下一步 | 对比表（写入 `scripts/perf/results/`） |
| 7 完成优化 | 提交 feature 分支 → PR（CI + 必要检查）→ 合入本地 dev 并验证；更新待办/基线 | PR + dev 验证 |
| 8 继续扫描 | 从其它模块/层重新开始第 1 步；把未动但记录的候选项列入「待办池」 | 更新后的待办池 |

## 度量分级

- **Tier A（任何环境可跑）**：`scripts/perf/run.mjs` — 对真实会话日志（zstd JSONL）解码并测量：会话体积/行数/最大消息、窗口化前后挂载行数、每帧分组耗时、Streamdown 解析耗时（10KB/40KB）、冲刷频率算术、review 扫描冷/热、冷开解码。纯 Node，无 GUI 依赖，出入 `scripts/perf/results/*.json`（目录 gitignore）。用法：

  ```
  node --experimental-strip-types scripts/perf/run.mjs [--sessions-dir DIR] [--top N] [--out FILE]
  node --experimental-strip-types scripts/perf/run.mjs --compare results/before.json --out results/after.json [--fail-over 50]
  # 或 pnpm perf / pnpm perf:compare <before.json> --out <after.json>
  ```
- **Tier A'（vitest 回归）**：`packages/ui/src/chat/__tests__/perf-regression.test.ts` —— 针对纯函数（2000 消息分组、2000 轮次窗口化+消息上限、40KB markdown 解析）的宽松上限回归（≈实测 100×，专防复杂度级回退）。另有语义级守卫（冲刷单提交、窗口守卫、缓存正确性）分散在相关套件。
- **Tier B（桌面构建后）**：重新构建/安装应用后，用 DevTools Performance 面板录制：流式 30s 长回复的 Main 线程任务时长占比、每帧渲染耗时、rail 重渲染次数、内存（DOM 节点数）。Tier B 步骤在每次桌面构建后作为验证轮执行。

## 指标表（会话性能）

| 指标 | 说明 | Tier | 基线（2026-09-25 实测，`scripts/perf/results/latest.json`） | 当前目标 |
|---|---|---|---|---|
| mounted-rows | 窗口化后的挂载行数（before=整段） | A | 最大会话（18MB 解码）OLD=76 → NEW=76（隐藏 1054 轮次），展开+1=174 | ≤ 160 |
| commits-per-sec | 流式提交频率（before=120/s 双 RAF） | A | 算术 120/s → 30/s | ≤ 30 |
| streamdown-parse-ms@10KB / @40KB | 每帧 markdown 全量重解析耗时（中位数） | A | 0.598ms / 1.794ms | 记录对比 |
| streaming-body-parse | 流式期间正文是否走 markdown 重解析 | A | 0（纯文本，STREAMING_PLAIN_TEXT） | 0 |
| grouping-ms-per-run | 每帧 O(N) 消息分组耗时（中位数） | A | 0.025ms | 记录对比 |
| flush-parse-ms-per-sec@40KB | 每秒纯解析 CPU（before 120/s vs after 30/s） | A | 215ms/s → 54ms/s | ≤ 60 |
| copy-prose-derive-per-frame | 已落定组的 copy 文案推导（WeakMap 缓存后） | A | 首次 O(消息体)，之后 O(1)/帧 | O(1) |
| workspace-review-scan/frame | 已落定轮次的文件变更扫描（16 个 ~44KB patch 事件） | A | 冷 0.015ms → 缓存后 0.0035ms（随结果规模/轮次线性放大） | ≤0.01ms |
| rail-rerenders-sec | rail 每秒重渲染（before=30/s） | B | — | ≈0（仅窗口变化） |
| glass-measure-per-frame | 流式期间玻璃测量/强制布局/Image.decode | B | — | 0（仅落定） |
| window-change-report-sec | onTurnsWindowChange 每秒触发 | B | — | ≈0（仅在变化） |
| session-open-decode-ms | 冷启动解码（缓存未命中，zstd→JSONL） | A | 18MB 会话 82ms / 11MB 会话 38ms | 记录对比 |
| window-render-ms (jsdom) | 160 行窗口端到端挂载（20 个已落定 markdown + 流式行） | A' | 121ms（jsdom；真实浏览器 ≈ 1/10） | 记录对比 |
| index-stringify-ms | 326 条会话索引 JSON.stringify | A | 0.046ms | 噪音，关闭 |

## 扫描检查清单（第 1 步用）

**渲染层（packages/ui）**
- [ ] 是否还有"每次流式帧都跑"的 O(N) 派生/遍历（分组、flatMap、JSON 序列化）
- [ ] 是否每帧构建会被 memo 的 props（数组/对象字面量、内联闭包、非稳定 hook 返回值）
- [ ] 是否每帧触发 setState（effect 依赖数组身份、useSyncExternalStore 快照身份）
- [ ] 是否每帧触发强制布局（offsetHeight/clientWidth/getBoundingClientRect/scrollTop 写）
- [ ] 是否每帧重建大字符串/SVG data-URI/Image.decode
- [ ] 是否有"渲染了但看不到"的子树（隐藏 copy 计算、隐藏面板）

**数据层（packages/app-runtime / plugins/dsh-plugin-ui-shell）**
- [ ] 订阅通知是否按 key 隔离（activeMessages 与 shell 分离）
- [ ] 持久化/序列化是否在流式期间高频执行（stringify 巨型结构）
- [ ] 快照/事件处理器是否为 O(事件量) 且每事件触发 setState
- [ ] 跨进程帧是否批量（structuredClone 次数）

**桌面层（apps/desktop）**
- [ ] 引擎是否在独立进程（不阻塞渲染/主进程）
- [ ] 渲染进程→主进程是否有每帧高频 IPC/广播
- [ ] 窗口切换/会话切换是否有未缓存的重解码

## 待办池（未动但已记录的候选项）

| 候选 | 为什么暂缓 | 触发条件 |
|---|---|---|
| Composer memo | props 每帧新对象（attachments 返回值/槽位渲染器/内联闭包），需 3 模块稳定化 + 自定义比较器；主输入面回归风险 > 帧收益 | 若流式期间打字仍卡，优先做「稳定 useComposerAttachments 返回对象」后重评 |
| SidebarItem memo | 列表仅在 sessions 索引变化时重渲（轮次边界非帧级） | 会话数 >1000 或索引变化频率升高时 |
| 分组结构签名 memo | 实测 0.11ms/帧，收益 < 签名正确性风险 | 平均消息数 >5000 时重评 |
| DSH 侧整段解码 loadMessages | 属 DSH 投影层，非本仓库 UI 范围 | 若会话开关 >500ms（Tier B 测） |
| 启用背景时的 backdrop-filter 合成 | 当前未启用背景（flat 模式 blur=0）；启用后 64px 模糊按帧重合成 | 用户启用动态背景后做 GPU 层提升/降采样 |

## 优化记录（2026-09-25 首轮全量执行）

| # | 优化 | 手段 | 实测证据 |
|---|---|---|---|
| 1 | 流式冲刷合并+限流 | 单提交/帧，帧门控 ~30fps | 解析 CPU 215→54 ms/s @40KB（120→30 提交/s） |
| 2 | 会话窗口消息上限 | `MESSAGE_DOM_CAP=160` 折叠旧轮 | 840 行会话初始挂载 ≤160；上滑逐屏展开 |
| 3 | 流式正文纯文本 | `STREAMING_PLAIN_TEXT`，落定转 markdown | 流式期间 0 次 markdown 重解析 |
| 4 | 玻璃流式延迟 | `useMessageGlass` 落定才测量；平面卡兜底 | 流式期间 0 次强制布局+SVG+Image.decode |
| 5 | rail 逐帧空转守卫 | 窗口内容签名，变化才上报 | rail 30/s → ≈0（仅窗口变化） |
| 6 | copy 文案缓存/跳过 | 流式组跳过；WeakMap 按消息对象缓存 | 已落定组 O(1)/帧（原每帧重导） |
| 7 | 文件变更扫描缓存 | ToolProgress 对象 WeakMap | review 冷 0.015ms → 热 0.0035ms/帧 |
| 8 | 自动滚动去重写 | scrollTop 值相同不写 | 无谓滚动写清零 |
| 9 | 指针移动布局守卫 | `isObserved()` 无订阅者跳过 rect 读取 | 流式期间鼠标移动不再强制布局 |
| 10 | 壁纸异步解码 | `decoding="async"` | 4K 背景不阻塞首屏 |
| — | 工作流工具 | `run.mjs` + `--compare/--fail-over` + `perf-regression.test.ts` + `pnpm perf` | 跨轮漂移复测无 ≥50% 劣化 |

验证口径：chat+primitives 644 通过 / ui-shell 33 通过（仅 2 个改动前同款环境性失败）；PR #103（12 commits,+1521/−125）MERGEABLE，PR checks/UI shell SUCCESS。

## 项目集成## 项目集成

- 所有修复走 feature worktree → PR → 本地 dev 合并验证（见 AGENTS.md）。
- 指标与对比表随 PR 提交，存放在 `scripts/perf/results/`。
- 每轮结束更新本文件的「指标表」与「待办池」。