# amiba-backplane

amiba desktop 的**本地 HTTP 后端 server**(独立进程,**不是 hermes plugin**)。
由 desktop spawn + 监管(desktop 是进程主管),把 Hermes core 的能力暴露成本机客户端
(浏览器扩展、桌面渲染端)能消费的 HTTP。默认监听 `127.0.0.1:9394`(用
`HERMES_BACKPLANE_PORT` 覆盖)。

启动:`python -m amiba_backplane.server --port 9394`(或 console
script `amiba-backplane`)。

## 定位:独立 server,不是 plugin

它**曾经**被当 hermes plugin 加载(`register(ctx)` + `plugin.yaml`)—— 但那不是因为
它要给 agent 加能力(它 `provides_tools: []`、`hooks: []`,一样都不注册),纯粹是
**为了挤进 gateway 进程**:plugin loader 是进 gateway 进程的唯一一道门。这是没有
进程主管时的无奈外壳。

现在 **desktop 当进程主管**(它已经在 spawn gateway),backplane 不用再蹭谁的进程
—— desktop 直接把它当 server spawn 起来,plugin 外壳整个脱掉。它回归本来就是的
东西:一个 HTTP server。`register(ctx)` / `plugin.yaml` / `hermes_agent.plugins`
entry-point 都已删除。

> 对比:`amiba-plugin-browser-tools`(注册 `my_browser_*` tools + WS hub)**仍是
> 真 plugin** —— 它确实给 agent 加能力。
>
> 新的 @ 提及能力由 Applet manifest 声明，并跟随 Applet 安装、升级和移除。本仓只
> 对升级前已经位于 `~/.hermes/mention-sources/` 的来源保留只读兼容加载；不再提供
> 独立的安装、更新或删除生命周期。

设计见 amiba 仓 `docs/superpowers/specs/2026-06-09-desktop-centric-backend-design.md`。

## 仓库关系

本仓是这个 stack 的**后端 HTTP 层**：

| Repo | 角色 |
|---|---|
| **this repo** | 本地 HTTP server：`/hermes/*`，以及升级前 mention source 的只读 search/resource 兼容路由 |
| `~/.hermes/mention-sources/<name>/` | 旧版来源数据；只读加载，等待迁移到所属 Applet，不再由 backplane 管理生命周期 |
| [amiba-plugin-browser-tools](https://github.com/amiba-desktop/amiba-plugin-browser-tools) | 给 agent 的 browser 工具（screenshot / navigate / inbox 等），通过 WS bridge 连扩展（**仍是真 plugin**） |
| [hermes-my-browser-extension](https://github.com/iHeyTang/hermes-my-browser-extension) | Chrome 扩展前端，调本插件的 `/hermes/*` 端点 |

本仓本身就提供 `/hermes/*` 全套 + `/mention-sources/*`(框架自己加载
`~/.hermes/mention-sources/`)。`/v1/*`(聊天)反代给 gateway,要聊天得有 gateway 在跑。
`browser-tools` 仍是 plugin,装进 gateway。

```bash
# 它现在是独立 server,由 desktop spawn(开发期手动起):
pip install -e .                       # 装本地副本(需要 hermes-agent 可 import)
amiba-backplane --port 9394         # 或 python -m amiba_backplane.server
# 聊天用的 gateway 另起(desktop 会一并 spawn+监管这两个进程):
hermes gateway run
```

## 两条 lane

### `/hermes/*` — Hermes core 的 HTTP 表面

包装 Hermes 自身的 Python 子系统（`hermes_state.SessionDB`、`cron.jobs`、
`config.yaml`、`agent.model_metadata` 等）为 HTTP。Hermes Agent 官方 dashboard
（`hermes_cli/web_server.py`）暴露的是 `/api/*`；本插件镜像了里面跨任务通用的
那一部分，并对子路径 / method / payload 与上游保持对齐 —— **路由前缀不同
（`/hermes` vs `/api`），但 endpoint 之后的形状一致**，换 base URL 即可互通。

完整对照、缺口、扩展字段：见 [`docs/api-parity.md`](docs/api-parity.md)。

主要子模块（详见 `runtime/features/hermes_proxy/`）：

| 子模块 | 路径前缀 | 用途 |
|---|---|---|
| `cron` | `/hermes/cron/*` | 定时任务 CRUD + 输出索引 |
| `sessions` | `/hermes/sessions/*` | `SessionDB` 读 + mine-only 的写 |
| `settings.model_routes` | `/hermes/model/*` + `/hermes/provider-models` + `/hermes/provider-credentials` | 模型 / provider 配置 |
| `settings.memory_routes` | `/hermes/memories*` | MEMORY.md / USER.md 视图（mine-only） |
| `settings.skills_routes` | `/hermes/skills*` | 技能列表 / 文件浏览 / 启停 |
| `attachments` | `/hermes/attachments*` | 会话附件上传/删除 |
| `mention_sources_gateway` | `/mention-sources/<name>/search` + `/hermes/mention-resources` | 旧版来源的只读兼容适配层（**不是** agent tool） |

### 旧版 mention source 兼容

`mention_sources_gateway` 只为升级前已经安装的来源保留两个只读能力：

- `GET  /mention-sources/<name>/search?type=&q=` —— 进程内调源声明的 `search`；
- `GET  /hermes/mention-resources` —— 聚合各源的 `mention_resources`，给 composer 的 `@` 提及；

没有 `/hermes/mention-sources*` 管理 API。新的提及能力使用 Applet manifest 的
`mentions` 声明，并与 Applet 共用一套生命周期。

## 关键设计点

- **独立 server,不是 plugin**：由 desktop spawn(`amiba-backplane` /
  `python -m …server`),不再有 `register(ctx)` / `plugin.yaml` /
  `_is_agent_invocation` 那套 plugin-mode 机制 —— 见开头「定位」一节。
- **兼容加载旧来源**：启动时 `server.py:_load_mention_sources()` 调兼容 loader 的
  `runtime.mention_sources.load_all_and_wire()`,把 `~/.hermes/mention-sources/`
  载进注册表 + 把各源的 `skills/` 接进 agent 的 `skills.external_dirs`。没装源就空
  注册表降级。
- **`/hermes/*` 不需要活 agent**：它是对 `~/.hermes/` 的文件级视图,只要
  hermes-agent 这个 Python 包可 import。只有 `/v1/*` 反代 gateway,需要 gateway 在跑。
- **错误隔离**：HTTP handler 抛异常被 aiohttp 兜成 500,不传染本进程主循环。

## 文档

- [`docs/api-parity.md`](docs/api-parity.md) —— 与 Hermes 官方 `/api/*` 的逐端点
  对照（共有 / 官方独有 / 我们独有 / 全局残留 / 变更日志）。**持续维护，
  每次改 backplane 或 upstream 升级要同步更新。**
- Applet 与 Mention Contribution 的长期设计见仓库根目录的统一 Extension 设计文档。

## 配置

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `HERMES_BACKPLANE_PORT` | `9394` | 监听端口 |
| `HERMES_HOME` | `~/.hermes` | Hermes 主目录 |
| `HERMES_BACKPLANE_FORCE_START` | unset | 设 `1` 强制起 server（绕过 CLI 模式判断；测试 / 调试用） |

## 开发

```bash
pip install -e .                # 装本地副本
hermes chat                     # 触发插件加载 + 起 server
curl http://127.0.0.1:9394/hermes/sessions   # smoke test
```

文件布局：

src-layout —— 包就是 `amiba_backplane/`,子包**自动发现**(`packages.find`),
不再手维护清单:

```
pyproject.toml                      # 包元数据 + console script `amiba-backplane`
amiba_backplane/
  __init__.py
  runtime/
    server.py                       # 启动入口：load 源 + 起 aiohttp
    http_app.py                     # aiohttp Application 工厂
    common.py                       # json_error / strip_ok / read_json_object
    adapters/                       # 适配 Hermes core 的薄包装
    mention_sources/                # 旧版来源的只读兼容 loader + resolver skill 接线
    features/
      hermes_proxy/                 # 全部路由：/hermes/* + mention_sources_gateway
tests/                              # pytest（无需 conftest 桩，src-layout 原生可跑）
docs/api-parity.md                  # 与官方 API 对照
```

（`runtime/mention_sources/` 仅用于已有用户数据的只读迁移兼容。）

## License

跟随 Hermes Agent。
