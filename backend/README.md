# hermes-x-backplane

hermes-x desktop 的**本地 HTTP 后端 server**(独立进程,**不是 hermes plugin**)。
由 desktop spawn + 监管(desktop 是进程主管),把 Hermes core(以及内置的
**integrations 框架**)的能力暴露成本机客户端(浏览器扩展、桌面渲染端)能消费的
HTTP。默认监听 `127.0.0.1:9394`(用 `HERMES_BACKPLANE_PORT` 覆盖)。

启动:`python -m hermes_x_backplane.server --port 9394`(或 console
script `hermes-x-backplane`)。

## 定位:独立 server,不是 plugin

它**曾经**被当 hermes plugin 加载(`register(ctx)` + `plugin.yaml`)—— 但那不是因为
它要给 agent 加能力(它 `provides_tools: []`、`hooks: []`,一样都不注册),纯粹是
**为了挤进 gateway 进程**:plugin loader 是进 gateway 进程的唯一一道门。这是没有
进程主管时的无奈外壳。

现在 **desktop 当进程主管**(它已经在 spawn gateway),backplane 不用再蹭谁的进程
—— desktop 直接把它当 server spawn 起来,plugin 外壳整个脱掉。它回归本来就是的
东西:一个 HTTP server。`register(ctx)` / `plugin.yaml` / `hermes_agent.plugins`
entry-point 都已删除。

> 对比:`hermes-x-plugin-browser-tools`(注册 `my_browser_*` tools + WS hub)**仍是
> 真 plugin** —— 它确实给 agent 加能力。
>
> 而 **integrations 框架已经收进本仓**(`runtime/integrations/`):当初那个
> `hermes-x-plugin-integrations` 插件 `provides_tools: []`、`hooks: []`,只被
> backplane 读注册表(还在另一个进程,连它的进程内副本都共享不了)—— 是个
> composer/backplane 的事穿了插件马甲,跟 backplane 自己当初一模一样。所以它脱掉
> 马甲搬了进来,不再是独立插件。integration *实例*(如 lark)仍是可插拔的独立包,
> 装在 `~/.hermes/integrations/`。

设计见 hermes-x 仓 `docs/superpowers/specs/2026-06-09-desktop-centric-backend-design.md`。

## 仓库关系

本仓是这个 stack 的**后端 HTTP 层**：

| Repo | 角色 |
|---|---|
| **this repo** | 本地 HTTP server：`/hermes/*` + integrations gateway（`/integrations/<name>/search`、`/hermes/mention-resources`、`/hermes/integrations*`）+ **内置 integrations 框架**（`runtime/integrations/`：协议 + loader/manager + skills 接线） |
| `~/.hermes/integrations/<name>/`（如 [hermes-x-integration-lark](https://github.com/iHeyTang/hermes-x-integration-lark)） | 可插拔的 integration **实例**（声明 `search` + `integration.yaml` + resolver skill）；由本仓的框架加载/管理（`hermes-x-plugin-integrations` 插件已退役） |
| [hermes-x-plugin-browser-tools](https://github.com/iHeyTang/hermes-x-plugin-browser-tools) | 给 agent 的 browser 工具（screenshot / navigate / inbox 等），通过 WS bridge 连扩展（**仍是真 plugin**） |
| [hermes-my-browser-extension](https://github.com/iHeyTang/hermes-my-browser-extension) | Chrome 扩展前端，调本插件的 `/hermes/*` 端点 |

本仓本身就提供 `/hermes/*` 全套 + `/integrations/*`(框架自己加载
`~/.hermes/integrations/`)。`/v1/*`(聊天)反代给 gateway,要聊天得有 gateway 在跑。
`browser-tools` 仍是 plugin,装进 gateway。

```bash
# 它现在是独立 server,由 desktop spawn(开发期手动起):
pip install -e .                       # 装本地副本(需要 hermes-agent 可 import)
hermes-x-backplane --port 9394         # 或 python -m hermes_x_backplane.server
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
| `integrations_gateway` | `/hermes/integrations*` + `/integrations/<name>/search` + `/hermes/mention-resources` | 本仓内置 integrations 框架（`runtime/integrations/`）的 HTTP 适配层（**不是** agent tool） |

### integrations gateway —— `/integrations/<name>/search` 等

集成**框架**（loader / manager / skills 接线）就在本仓 `runtime/integrations/`（曾经是
独立的 `hermes-x-plugin-integrations` 插件，已退役搬入 —— 见开头「定位」一节）。集成
**实例**是 **HTTP-agnostic 的纯能力**（只声明一个 `search` 能力 + manifest，不碰
aiohttp），可插拔地装在 `~/.hermes/integrations/<name>/`。`integrations_gateway` 是
**HTTP 适配层**（`runtime/features/hermes_proxy/integrations_gateway/`），进程内读框架
注册表，把它适配成 HTTP：

- `GET    /integrations/<name>/search?type=&q=` —— 进程内调集成声明的 `search` 能力；
- `GET    /hermes/mention-resources` —— 聚合各集成的 `mention_resources`，给 composer 的
  `@` 提及；
- `GET/POST/DELETE /hermes/integrations*` —— lifecycle admin（list / install
  (from git/path) / reload / remove），desktop UI 调它（不再有 `hermes integration`
  CLI）。

万一框架不可用，这几条路由优雅降级（空注册表 / 503），backplane 其余部分不受影响。
HTTP 这层完全由本仓负责，集成自己一点 HTTP 都不沾。

## 关键设计点

- **独立 server,不是 plugin**：由 desktop spawn(`hermes-x-backplane` /
  `python -m …server`),不再有 `register(ctx)` / `plugin.yaml` /
  `_is_agent_invocation` 那套 plugin-mode 机制 —— 见开头「定位」一节。
- **自己加载集成**：启动时 `server.py:_load_integrations()` 调内置框架的
  `runtime.integrations.load_all_and_wire()`,把 `~/.hermes/integrations/` 载进
  注册表 + 把各集成的 `skills/` 接进 agent 的 `skills.external_dirs`。没装集成就空
  注册表降级。
- **`/hermes/*` 不需要活 agent**：它是对 `~/.hermes/` 的文件级视图,只要
  hermes-agent 这个 Python 包可 import。只有 `/v1/*` 反代 gateway,需要 gateway 在跑。
- **错误隔离**：HTTP handler 抛异常被 aiohttp 兜成 500,不传染本进程主循环。

## 文档

- [`docs/api-parity.md`](docs/api-parity.md) —— 与 Hermes 官方 `/api/*` 的逐端点
  对照（共有 / 官方独有 / 我们独有 / 全局残留 / 变更日志）。**持续维护，
  每次改 backplane 或 upstream 升级要同步更新。**
- 集成怎么写（`search` 能力 + `integration.yaml` + resolver skill）—— 见
  `runtime/integrations/`(框架)和参考实现
  [`hermes-x-integration-lark`](https://github.com/iHeyTang/hermes-x-integration-lark)
  的 README 和它内置的 `integration-management` skill（不在本仓）。

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

```
__init__.py                       # 仅包 docstring（已无 plugin 机制）
pyproject.toml                    # 包元数据 + console script `hermes-x-backplane`
runtime/
  server.py                       # 启动入口：load 集成 + 起 aiohttp（python -m …server）
  http_app.py                     # aiohttp Application 工厂
  common.py                       # json_error / strip_ok / read_json_object
  adapters/                       # 适配 Hermes core 的薄包装
  integrations/                   # 内置的 integrations 框架（loader / manager / skills 接线）
  features/
    hermes_proxy/                 # 全部路由：/hermes/* + integrations_gateway
docs/api-parity.md                # 与官方 API 对照
```

（集成**框架**在本仓 `runtime/integrations/`；集成**实例**（如 lark）是独立可插拔包，
装在 `~/.hermes/integrations/`。）

## License

跟随 Hermes Agent。
