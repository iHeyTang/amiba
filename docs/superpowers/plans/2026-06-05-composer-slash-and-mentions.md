# Composer 斜杠命令 + @ 引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 hermes-agent CLI 的「`/` 唤起命令、`@` 唤起引用」体验带到 hermes-x 的 web/desktop/扩展 聊天输入框。

**Architecture:** 用 Lexical 富文本编辑器替换 Composer 内部的 `<textarea>`，对外保持 `value:string` / `onChange(string)` 契约不变（5 个界面零改动）。`@` 引用是原子芯片节点，序列化成规范 token 串 `@[type:payload]`；`/` 命令是行首文本，发送时整行路由（多数发后端，少数触发 UI 动作）。命令与 personas 列表由 backplane 新增的两个只读接口实时下发（与 CLI 同一份 source of truth）。Provider 抽象：内置 5 个（slash/skills/sessions/personas/channels），桌面注入 Files、扩展注入 Page-context。

**Tech Stack:** React 18 + TypeScript + Lexical + Radix + Tailwind（packages/ui）；vitest（ui/core 测试，新增）；aiohttp + pytest（hermes-x-plugin-http-backplane，新增 pytest）；pnpm 9 workspace。

**Spec:** [docs/superpowers/specs/2026-06-05-composer-slash-and-mentions-design.md](../specs/2026-06-05-composer-slash-and-mentions-design.md)

---

## 重要约定（每个 Task 都适用）

- 所有 `pnpm` 命令在 monorepo 根 `/Users/zhangdehui/Documents/CodeRepo/hermes-x/hermes-x` 执行。
- 所有 `pytest` 命令在 `/Users/zhangdehui/Documents/CodeRepo/hermes-x/hermes-x-plugin-http-backplane` 执行。
- Git 身份：commit 用 `iHeyTang <dehui1012@gmail.com>`。每个 Task 末尾 commit。
- 分支：`feat/composer-slash-and-mentions`（已创建）。
- backplane base URL：`http://127.0.0.1:9394`；core 用 `backplaneFetch`（已带 Bearer 鉴权）。

## File Structure（创建/修改清单）

**Part 0 — 测试与依赖**
- Modify: `packages/core/package.json`（+vitest、test script）
- Create: `packages/core/vitest.config.ts`
- Modify: `packages/ui/package.json`（+vitest、@testing-library、jsdom、lexical 全家桶、test script）
- Create: `packages/ui/vitest.config.ts`、`packages/ui/src/test/setup.ts`
- Modify: `hermes-x-plugin-http-backplane/pyproject.toml`（+dev deps）
- Create: `hermes-x-plugin-http-backplane/pytest.ini`、`hermes-x-plugin-http-backplane/tests/conftest.py`

**Part 1 — 后端接口 + core 客户端**
- Create: `hermes-x-plugin-http-backplane/runtime/features/hermes_proxy/settings/commands_service.py`
- Create: `hermes-x-plugin-http-backplane/runtime/features/hermes_proxy/settings/commands_routes.py`
- Create: `hermes-x-plugin-http-backplane/runtime/features/hermes_proxy/settings/personalities_service.py`
- Create: `hermes-x-plugin-http-backplane/runtime/features/hermes_proxy/settings/personalities_routes.py`
- Modify: `hermes-x-plugin-http-backplane/runtime/features/hermes_proxy/settings/__init__.py`
- Create: `hermes-x-plugin-http-backplane/tests/test_commands_routes.py`、`tests/test_personalities_routes.py`
- Create: `packages/core/src/hermes-commands.ts`、`packages/core/src/hermes-personalities.ts`
- Modify: `packages/core/src/index.ts`（导出）
- Create: `packages/core/src/__tests__/hermes-commands.test.ts`、`hermes-personalities.test.ts`

**Part 2 — Lexical 编辑器内核**
- Create: `packages/ui/src/chat/composer/RichComposerEditor.tsx`
- Create: `packages/ui/src/chat/composer/plugins/AutoGrowPlugin.tsx`、`ImeEnterPlugin.tsx`、`PlaceholderPlugin.tsx`、`ValueSyncPlugin.tsx`
- Create: `packages/ui/src/chat/composer/lexical-config.ts`（theme + nodes）
- Create: `packages/ui/src/chat/composer/__tests__/RichComposerEditor.test.tsx`
- Modify: `packages/ui/src/chat/Composer.tsx`（用 RichComposerEditor 替换 `<Textarea>`）

**Part 3 — 触发系统 + 序列化 + 芯片 + 菜单 + Skills provider**
- Create: `packages/ui/src/chat/composer/providers/types.ts`
- Create: `packages/ui/src/chat/composer/serialize.ts`（token ↔ 结构）
- Create: `packages/ui/src/chat/composer/MentionNode.tsx`
- Create: `packages/ui/src/chat/composer/plugins/MentionSerializePlugin.tsx`（节点树 ↔ value 串）
- Create: `packages/ui/src/chat/composer/plugins/TriggerPlugin.tsx`
- Create: `packages/ui/src/chat/composer/TriggerMenu.tsx`
- Create: `packages/ui/src/chat/composer/providers/skills.ts`
- Create: `packages/ui/src/chat/composer/providers/registry.ts`
- Create 对应 `__tests__/*`

**Part 4 — 其余内置 provider + 发送展开**
- Create: `packages/ui/src/chat/composer/expandMentions.ts`
- Create: `packages/ui/src/chat/composer/providers/slash.ts`、`slash-ui-actions.ts`、`sessions.ts`、`personas.ts`、`channels.ts`
- Modify: `packages/ui/src/chat/Composer.tsx`（onSubmit 接 expand + 命令路由）
- Create 对应 `__tests__/*`

**Part 5 — 注入 provider**
- Create: `packages/ui/src/chat/composer/providers/injectable.ts`（Files / PageContext 接口）
- Modify: `packages/ui/src/chat/Composer.tsx`、`ChatSurface.tsx`（`mentionProviders` prop 透传）
- Modify: `apps/desktop/src/main/ipc.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/preload/index.d.ts`
- Create: `apps/desktop/src/renderer/chat/files-provider.ts`
- Create: `apps/browser-extension/src/lib/chat/page-context-provider.ts`
- Modify: desktop / extension 挂载 ChatSurface 处，传入 provider

---

# Part 0 — 测试基建与依赖

### Task 0.1: 给 packages/core 加 vitest

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`
- Test: `packages/core/src/__tests__/smoke.test.ts`

- [ ] **Step 1: 加依赖与 script**

修改 `packages/core/package.json`：`scripts` 增加 `"test": "vitest run"`、`"test:watch": "vitest"`；`devDependencies` 增加 `"vitest": "^2.1.4"`。

- [ ] **Step 2: 写 vitest 配置**

Create `packages/core/vitest.config.ts`：
```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
})
```

- [ ] **Step 3: 写冒烟测试**

Create `packages/core/src/__tests__/smoke.test.ts`：
```typescript
import { describe, expect, it } from "vitest"

describe("core test infra", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: 安装并跑测试**

Run: `pnpm install && pnpm --filter @hermes-x/core test`
Expected: 1 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/core/package.json packages/core/vitest.config.ts packages/core/src/__tests__/smoke.test.ts pnpm-lock.yaml
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "test: add vitest to packages/core"
```

### Task 0.2: 给 packages/ui 加 vitest（jsdom）+ testing-library + lexical 依赖

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/vitest.config.ts`、`packages/ui/src/test/setup.ts`
- Test: `packages/ui/src/test/smoke.test.tsx`

- [ ] **Step 1: 加依赖与 script**

修改 `packages/ui/package.json`：
- `scripts` 增加 `"test": "vitest run"`、`"test:watch": "vitest"`。
- `dependencies` 增加：`"lexical": "^0.21.0"`, `"@lexical/react": "^0.21.0"`, `"@lexical/text": "^0.21.0"`, `"@lexical/utils": "^0.21.0"`, `"@lexical/selection": "^0.21.0"`。
- `devDependencies` 增加：`"vitest": "^2.1.4"`, `"jsdom": "^25.0.1"`, `"@testing-library/react": "^16.0.1"`, `"@testing-library/user-event": "^14.5.2"`, `"@testing-library/jest-dom": "^6.6.3"`。

- [ ] **Step 2: vitest 配置 + setup**

Create `packages/ui/vitest.config.ts`：
```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
```

Create `packages/ui/src/test/setup.ts`：
```typescript
import "@testing-library/jest-dom/vitest"
```

- [ ] **Step 3: 冒烟测试**

Create `packages/ui/src/test/smoke.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("ui test infra", () => {
  it("renders", () => {
    render(<div>hello</div>)
    expect(screen.getByText("hello")).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: 安装并跑**

Run: `pnpm install && pnpm --filter @hermes-x/ui test`
Expected: 1 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/package.json packages/ui/vitest.config.ts packages/ui/src/test/setup.ts packages/ui/src/test/smoke.test.tsx pnpm-lock.yaml
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "test: add vitest+lexical deps to packages/ui"
```

### Task 0.3: 给 backplane 加 pytest

**Files:**
- Modify: `hermes-x-plugin-http-backplane/pyproject.toml`
- Create: `hermes-x-plugin-http-backplane/pytest.ini`、`tests/conftest.py`、`tests/test_smoke.py`

- [ ] **Step 1: pyproject dev deps**

修改 `pyproject.toml` 增加：
```toml
[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-asyncio>=0.21",
    "aiohttp>=3.9",
]
```

- [ ] **Step 2: pytest.ini + conftest**

Create `pytest.ini`：
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
```

Create `tests/conftest.py`：
```python
import sys
from pathlib import Path

# Make `runtime.*` and the sibling hermes-agent importable in tests.
_ROOT = Path(__file__).resolve().parents[1]
_AGENT = _ROOT.parent / "hermes-agent"
for p in (_ROOT, _AGENT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
```

- [ ] **Step 3: 冒烟测试**

Create `tests/test_smoke.py`：
```python
def test_smoke():
    assert 1 + 1 == 2
```

- [ ] **Step 4: 跑测试**

Run: `cd /Users/zhangdehui/Documents/CodeRepo/hermes-x/hermes-x-plugin-http-backplane && python -m pytest tests/test_smoke.py -v`
Expected: 1 passed。（若缺 pytest：先 `python -m pip install -e ".[dev]"`）

- [ ] **Step 5: Commit**
```bash
cd /Users/zhangdehui/Documents/CodeRepo/hermes-x/hermes-x-plugin-http-backplane
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "test: add pytest infra to backplane"
```
> 注：backplane 是独立 git 仓库时在其目录内 commit；若与主仓同管则统一在主仓 commit。先 `git rev-parse --show-toplevel` 确认。

---

# Part 1 — 后端两接口 + core 客户端

### Task 1.1: backplane commands_service（过滤 + 序列化）

**Files:**
- Create: `runtime/features/hermes_proxy/settings/commands_service.py`
- Test: `tests/test_commands_service.py`

- [ ] **Step 1: 写失败测试**

Create `tests/test_commands_service.py`：
```python
from runtime.features.hermes_proxy.settings.commands_service import (
    list_commands_response,
)


def test_returns_list_of_dicts_with_expected_fields():
    cmds = list_commands_response()
    assert isinstance(cmds, list)
    assert cmds, "expected at least one command"
    sample = cmds[0]
    for key in ("name", "description", "category", "aliases", "args_hint", "subcommands"):
        assert key in sample


def test_excludes_cli_only_and_messaging_only_commands():
    names = {c["name"] for c in list_commands_response()}
    # cli_only commands must not leak to web/desktop
    assert "clear" not in names      # cli_only
    assert "config" not in names     # cli_only
    # messaging-platform-only commands excluded explicitly
    assert "start" not in names
    assert "approve" not in names
    assert "sethome" not in names


def test_includes_everywhere_commands():
    names = {c["name"] for c in list_commands_response()}
    assert "new" in names
    assert "model" in names
    assert "status" in names
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/test_commands_service.py -v`
Expected: FAIL（ModuleNotFoundError: commands_service）。

- [ ] **Step 3: 实现 service**

Create `runtime/features/hermes_proxy/settings/commands_service.py`：
```python
"""Serialize hermes_cli COMMAND_REGISTRY for web/desktop clients.

Single source of truth: hermes_cli.commands.COMMAND_REGISTRY (same data the
CLI and gateways use). We expose only commands meaningful to a non-CLI HTTP
client, reusing the registry's own gateway-availability rule and dropping the
handful of commands that only make sense on messaging platforms.
"""
from __future__ import annotations

from typing import Any, Dict, List

# Commands that are only meaningful on messaging platforms (Telegram/Slack/...),
# not in a web/desktop chat surface. Dropped from the web command list.
_MESSAGING_ONLY = {"start", "topic", "approve", "deny", "sethome"}


def list_commands_response() -> List[Dict[str, Any]]:
    from hermes_cli.commands import COMMAND_REGISTRY, _is_gateway_available

    out: List[Dict[str, Any]] = []
    for cmd in COMMAND_REGISTRY:
        if not _is_gateway_available(cmd):
            continue
        if cmd.name in _MESSAGING_ONLY:
            continue
        out.append(
            {
                "name": cmd.name,
                "description": cmd.description,
                "category": cmd.category,
                "aliases": list(cmd.aliases),
                "args_hint": cmd.args_hint,
                "subcommands": list(cmd.subcommands),
            }
        )
    return out
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/test_commands_service.py -v`
Expected: 3 passed。
> 若 `_is_gateway_available` 仍把某些 `_MESSAGING_ONLY` 之外的消息平台命令放进来导致断言失败，按实际输出把对应 name 补进 `_MESSAGING_ONLY`。

- [ ] **Step 5: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(backplane): commands_service serializing COMMAND_REGISTRY for web"
```

### Task 1.2: backplane commands_routes + 注册

**Files:**
- Create: `runtime/features/hermes_proxy/settings/commands_routes.py`
- Modify: `runtime/features/hermes_proxy/settings/__init__.py`
- Test: `tests/test_commands_routes.py`

- [ ] **Step 1: 写失败测试**

Create `tests/test_commands_routes.py`：
```python
import pytest
from aiohttp import web

from runtime.features.hermes_proxy.settings.commands_routes import (
    register_commands_routes,
)


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    register_commands_routes(app)
    return await aiohttp_client(app)


async def test_get_commands_returns_json_array(client):
    resp = await client.get("/hermes/commands")
    assert resp.status == 200
    data = await resp.json()
    assert isinstance(data, list)
    assert any(c["name"] == "new" for c in data)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/test_commands_routes.py -v`
Expected: FAIL（ImportError）。
> 若报 `aiohttp_client` fixture 缺失，在 dev deps 增加 `pytest-aiohttp>=1.0` 并 `pip install -e ".[dev]"`。

- [ ] **Step 3: 实现路由**

Create `runtime/features/hermes_proxy/settings/commands_routes.py`：
```python
from __future__ import annotations

from aiohttp import web

from .commands_service import list_commands_response
from ....common import json_error


async def handle_commands_list(_request: web.Request) -> web.Response:
    """GET /hermes/commands — slash commands available to web/desktop clients.

    Serialized live from hermes_cli.commands.COMMAND_REGISTRY, so it never
    drifts from what the CLI knows.
    """
    try:
        payload = list_commands_response()
    except Exception as exc:  # registry import / config errors -> 500
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_commands_routes(app: web.Application) -> None:
    app.add_routes([web.get("/hermes/commands", handle_commands_list)])
```
> `....common` 的相对层级与 `skills_routes.py` 的 `from ....common import json_error` 完全一致（同目录），直接照抄其 import 行。

- [ ] **Step 4: 在 register() 挂载**

修改 `runtime/features/hermes_proxy/settings/__init__.py`：在文件顶部 import 区加
```python
from .commands_routes import register_commands_routes
```
在 `register(app)` 函数体内加一行
```python
    register_commands_routes(app)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `python -m pytest tests/test_commands_routes.py -v`
Expected: 1 passed。

- [ ] **Step 6: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(backplane): GET /hermes/commands route"
```

### Task 1.3: backplane personalities_service + routes

**Files:**
- Create: `runtime/features/hermes_proxy/settings/personalities_service.py`、`personalities_routes.py`
- Modify: `settings/__init__.py`
- Test: `tests/test_personalities_routes.py`

- [ ] **Step 1: 写失败测试**

Create `tests/test_personalities_routes.py`：
```python
import pytest
from aiohttp import web

from runtime.features.hermes_proxy.settings.personalities_service import (
    list_personalities_response,
)
from runtime.features.hermes_proxy.settings.personalities_routes import (
    register_personalities_routes,
)


def test_service_includes_builtins():
    items = list_personalities_response()
    keys = {p["key"] for p in items}
    assert "helpful" in keys
    assert "concise" in keys
    sample = next(p for p in items if p["key"] == "helpful")
    assert "preview" in sample
    assert "builtin" in sample


@pytest.fixture
async def client(aiohttp_client):
    app = web.Application()
    register_personalities_routes(app)
    return await aiohttp_client(app)


async def test_get_personalities_route(client):
    resp = await client.get("/hermes/personalities")
    assert resp.status == 200
    data = await resp.json()
    assert isinstance(data, list)
    assert any(p["key"] == "helpful" for p in data)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/test_personalities_routes.py -v`
Expected: FAIL（ImportError）。

- [ ] **Step 3: 实现 service**

Create `runtime/features/hermes_proxy/settings/personalities_service.py`：
```python
"""Serialize agent personalities for web/desktop clients.

Same source the CLI's `/personality` completer reads:
load_config().agent.personalities (14 built-ins from DEFAULT_CONFIG + user
customs merged). `builtin` marks the keys that ship by default.
"""
from __future__ import annotations

from typing import Any, Dict, List

_PREVIEW_LEN = 80


def _builtin_keys() -> set[str]:
    try:
        from hermes_cli.config import DEFAULT_CONFIG  # type: ignore

        return set(
            (DEFAULT_CONFIG.get("agent", {}) or {}).get("personalities", {}) or {}
        )
    except Exception:
        # Stable fallback: the 14 keys shipped in DEFAULT_CONFIG.
        return {
            "helpful", "concise", "technical", "creative", "teacher",
            "kawaii", "catgirl", "pirate", "shakespeare", "surfer",
            "noir", "uwu", "philosopher", "hype",
        }


def list_personalities_response() -> List[Dict[str, Any]]:
    from hermes_cli.config import load_config  # type: ignore

    cfg = load_config() or {}
    personalities = (cfg.get("agent", {}) or {}).get("personalities", {}) or {}
    builtins = _builtin_keys()
    out: List[Dict[str, Any]] = []
    for key, prompt in personalities.items():
        text = prompt if isinstance(prompt, str) else ""
        preview = text[:_PREVIEW_LEN].strip()
        out.append({"key": key, "builtin": key in builtins, "preview": preview})
    out.sort(key=lambda p: (not p["builtin"], p["key"]))
    return out
```
> `DEFAULT_CONFIG` 若在 `hermes_cli.config` 不叫这个名字，fallback 分支已兜底（14 个稳定 key）。可在实现时 `grep -n "DEFAULT_CONFIG" hermes_cli/config.py` 确认符号名后微调 import。

- [ ] **Step 4: 实现路由 + 注册**

Create `runtime/features/hermes_proxy/settings/personalities_routes.py`：
```python
from __future__ import annotations

from aiohttp import web

from .personalities_service import list_personalities_response
from ....common import json_error


async def handle_personalities_list(_request: web.Request) -> web.Response:
    """GET /hermes/personalities — agent personalities (builtin + custom)."""
    try:
        payload = list_personalities_response()
    except Exception as exc:
        return json_error(500, str(exc))
    return web.json_response(payload)


def register_personalities_routes(app: web.Application) -> None:
    app.add_routes([web.get("/hermes/personalities", handle_personalities_list)])
```

修改 `settings/__init__.py`：import 区加 `from .personalities_routes import register_personalities_routes`，`register(app)` 内加 `register_personalities_routes(app)`。

- [ ] **Step 5: 跑测试确认通过**

Run: `python -m pytest tests/test_personalities_routes.py -v`
Expected: 2 passed。

- [ ] **Step 6: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(backplane): GET /hermes/personalities route"
```

### Task 1.4: core getHermesCommands()

**Files:**
- Create: `packages/core/src/hermes-commands.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/hermes-commands.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/core/src/__tests__/hermes-commands.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getHermesCommands } from "../hermes-commands"

describe("getHermesCommands", () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.restoreAllMocks() })

  it("returns commands on success", async () => {
    const body = [
      { name: "new", description: "Start a new session", category: "Session",
        aliases: ["reset"], args_hint: "[name]", subcommands: [] },
    ]
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body)))
    const res = await getHermesCommands()
    expect(res.ok).toBe(true)
    expect(res.commands[0].name).toBe("new")
    expect(res.commands[0].aliases).toEqual(["reset"])
  })

  it("returns ok=false on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 }))
    const res = await getHermesCommands()
    expect(res.ok).toBe(false)
    expect(res.commands).toEqual([])
  })

  it("returns ok=false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("boom"))
    const res = await getHermesCommands()
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/core test -- src/__tests__/hermes-commands.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现客户端**

Create `packages/core/src/hermes-commands.ts`：
```typescript
import { backplaneFetch } from "./backplane-client"

export interface HermesCommand {
  name: string
  description: string
  category: string
  aliases: string[]
  args_hint: string
  subcommands: string[]
}

export interface HermesCommandsResponse {
  ok: boolean
  commands: HermesCommand[]
  error?: string
}

export async function getHermesCommands(): Promise<HermesCommandsResponse> {
  try {
    const res = await backplaneFetch("/hermes/commands", { method: "GET" })
    if (!res.ok) {
      return { ok: false, commands: [], error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as unknown
    const commands = Array.isArray(body) ? (body as HermesCommand[]) : []
    return { ok: true, commands }
  } catch (e) {
    return { ok: false, commands: [], error: String((e as Error)?.message || e) }
  }
}
```

- [ ] **Step 4: 导出 + 跑测试**

修改 `packages/core/src/index.ts` 增加 `export * from "./hermes-commands"`（紧挨现有 `export * from "./hermes-skills"`）。
Run: `pnpm --filter @hermes-x/core test -- src/__tests__/hermes-commands.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/hermes-commands.ts packages/core/src/index.ts packages/core/src/__tests__/hermes-commands.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(core): getHermesCommands client"
```

### Task 1.5: core getHermesPersonalities()

**Files:**
- Create: `packages/core/src/hermes-personalities.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/hermes-personalities.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/core/src/__tests__/hermes-personalities.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getHermesPersonalities } from "../hermes-personalities"

describe("getHermesPersonalities", () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.restoreAllMocks() })

  it("returns personalities on success", async () => {
    const body = [{ key: "helpful", builtin: true, preview: "You are a helpful" }]
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body)))
    const res = await getHermesPersonalities()
    expect(res.ok).toBe(true)
    expect(res.personalities[0].key).toBe("helpful")
  })

  it("returns ok=false on error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("x"))
    const res = await getHermesPersonalities()
    expect(res.ok).toBe(false)
    expect(res.personalities).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/core test -- src/__tests__/hermes-personalities.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现客户端**

Create `packages/core/src/hermes-personalities.ts`：
```typescript
import { backplaneFetch } from "./backplane-client"

export interface HermesPersonality {
  key: string
  builtin: boolean
  preview: string
}

export interface HermesPersonalitiesResponse {
  ok: boolean
  personalities: HermesPersonality[]
  error?: string
}

export async function getHermesPersonalities(): Promise<HermesPersonalitiesResponse> {
  try {
    const res = await backplaneFetch("/hermes/personalities", { method: "GET" })
    if (!res.ok) {
      return { ok: false, personalities: [], error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as unknown
    const personalities = Array.isArray(body) ? (body as HermesPersonality[]) : []
    return { ok: true, personalities }
  } catch (e) {
    return { ok: false, personalities: [], error: String((e as Error)?.message || e) }
  }
}
```

- [ ] **Step 4: 导出 + 跑测试**

`packages/core/src/index.ts` 增加 `export * from "./hermes-personalities"`。
Run: `pnpm --filter @hermes-x/core test -- src/__tests__/hermes-personalities.test.ts`
Expected: 2 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/hermes-personalities.ts packages/core/src/index.ts packages/core/src/__tests__/hermes-personalities.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(core): getHermesPersonalities client"
```

---

# Part 2 — Lexical 编辑器内核（保持契约 + 行为平替）

> 目标：做出一个 `<RichComposerEditor>`，对外 props 与现 textarea 用法等价（value/onChange/placeholder/keydown/auto-grow/imperative handle），然后替换 Composer 内的 `<Textarea>`。本 Part 结束时，输入框仍是纯文本，但底层是 Lexical，5 界面无回归。

### Task 2.1: RichComposerEditor 骨架 + value/onChange 纯文本往返

**Files:**
- Create: `packages/ui/src/chat/composer/lexical-config.ts`
- Create: `packages/ui/src/chat/composer/plugins/ValueSyncPlugin.tsx`
- Create: `packages/ui/src/chat/composer/RichComposerEditor.tsx`
- Test: `packages/ui/src/chat/composer/__tests__/RichComposerEditor.test.tsx`

- [ ] **Step 1: 写失败测试（受控往返）**

Create `packages/ui/src/chat/composer/__tests__/RichComposerEditor.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { RichComposerEditor } from "../RichComposerEditor"

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("")
  return (
    <RichComposerEditor
      value={v}
      onChange={(next) => { setV(next); onChange?.(next) }}
      placeholder="say something"
    />
  )
}

describe("RichComposerEditor", () => {
  it("emits typed text via onChange", async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const box = screen.getByRole("textbox")
    await userEvent.click(box)
    await userEvent.keyboard("hello")
    expect(onChange).toHaveBeenLastCalledWith("hello")
  })

  it("renders external value", () => {
    render(
      <RichComposerEditor value="preset" onChange={() => {}} />,
    )
    expect(screen.getByRole("textbox")).toHaveTextContent("preset")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: lexical 配置**

Create `packages/ui/src/chat/composer/lexical-config.ts`：
```typescript
import type { InitialConfigType } from "@lexical/react/LexicalComposer"

export const EDITOR_NAMESPACE = "hermes-composer"

export function baseEditorConfig(
  overrides: Partial<InitialConfigType> = {},
): InitialConfigType {
  return {
    namespace: EDITOR_NAMESPACE,
    onError: (e) => { throw e },
    nodes: [],
    theme: {
      paragraph: "m-0",
    },
    ...overrides,
  }
}
```

- [ ] **Step 4: ValueSyncPlugin（节点树 ↔ 纯文本 value）**

Create `packages/ui/src/chat/composer/plugins/ValueSyncPlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical"
import { useEffect, useRef } from "react"

/**
 * Two-way sync between Lexical state and a plain-text `value` string.
 * Phase 2: plain text only. Mention serialization is layered on in Part 3
 * (this plugin will be replaced by MentionSerializePlugin there).
 */
export function ValueSyncPlugin({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const lastEmitted = useRef<string | null>(null)

  // editor -> value
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent()
        if (text !== lastEmitted.current) {
          lastEmitted.current = text
          onChange(text)
        }
      })
    })
  }, [editor, onChange])

  // value -> editor (only when external value diverges from what we emitted)
  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      if (value) p.append($createTextNode(value))
      root.append(p)
    })
  }, [editor, value])

  return null
}
```

- [ ] **Step 5: RichComposerEditor**

Create `packages/ui/src/chat/composer/RichComposerEditor.tsx`：
```tsx
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import type { CSSProperties } from "react"
import { cn } from "../../primitives"
import { baseEditorConfig } from "./lexical-config"
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin"

export interface RichComposerEditorProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
}

export function RichComposerEditor(props: RichComposerEditorProps) {
  const { value, onChange, placeholder, disabled, className, style } = props
  return (
    <LexicalComposer initialConfig={baseEditorConfig({ editable: !disabled })}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              role="textbox"
              aria-multiline="true"
              spellCheck
              style={style}
              className={cn(
                "resize-none overflow-hidden border-0 bg-transparent text-sm outline-none",
                className,
              )}
            />
          }
          placeholder={
            placeholder ? (
              <div className="pointer-events-none absolute left-0 top-0 select-none text-sm text-muted-foreground">
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ValueSyncPlugin value={value} onChange={onChange} />
      </div>
    </LexicalComposer>
  )
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: 2 passed。

- [ ] **Step 7: Commit**
```bash
git add packages/ui/src/chat/composer/
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): RichComposerEditor scaffold with plain-text value sync"
```

### Task 2.2: 自动撑高 + 最大高度

**Files:**
- Create: `packages/ui/src/chat/composer/plugins/AutoGrowPlugin.tsx`
- Modify: `packages/ui/src/chat/composer/RichComposerEditor.tsx`
- Test: 追加到 `RichComposerEditor.test.tsx`

- [ ] **Step 1: 写测试（高度随内容更新、超限滚动）**

在 `RichComposerEditor.test.tsx` 追加：
```tsx
it("caps height at maxHeightPx and switches to scroll", async () => {
  const { container } = render(
    <RichComposerEditor value={"a\n".repeat(50)} onChange={() => {}} maxHeightPx={100} />,
  )
  const editable = container.querySelector('[role="textbox"]') as HTMLElement
  // jsdom 不计算真实布局，这里断言样式被写入（overflowY 被设置）
  expect(["auto", "hidden"]).toContain(editable.style.overflowY)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: FAIL（`maxHeightPx` 未支持 / overflowY 未设置）。

- [ ] **Step 3: AutoGrowPlugin**

Create `packages/ui/src/chat/composer/plugins/AutoGrowPlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLayoutEffect } from "react"

/** Mirror the old textarea auto-grow: grow to content, cap at maxHeightPx, then scroll. */
export function AutoGrowPlugin({ maxHeightPx }: { maxHeightPx: number }) {
  const [editor] = useLexicalComposerContext()
  useLayoutEffect(() => {
    const apply = () => {
      const el = editor.getRootElement()
      if (!el) return
      el.style.height = "auto"
      const sh = el.scrollHeight
      el.style.height = `${Math.min(sh, maxHeightPx)}px`
      el.style.overflowY = sh > maxHeightPx ? "auto" : "hidden"
    }
    apply()
    return editor.registerUpdateListener(() => apply())
  }, [editor, maxHeightPx])
  return null
}
```

- [ ] **Step 4: 接到 editor + 加 prop**

修改 `RichComposerEditor.tsx`：props 增加 `maxHeightPx?: number`（默认 `200`）；在 `<HistoryPlugin />` 后加 `<AutoGrowPlugin maxHeightPx={maxHeightPx ?? 200} />`；import AutoGrowPlugin。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: all passed。

- [ ] **Step 6: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(ui): composer auto-grow plugin"
```

### Task 2.3: IME 安全的 Enter/Cmd+Enter/Shift+Enter

**Files:**
- Create: `packages/ui/src/chat/composer/plugins/ImeEnterPlugin.tsx`
- Modify: `RichComposerEditor.tsx`
- Test: 追加 `RichComposerEditor.test.tsx`

- [ ] **Step 1: 写测试**

追加到测试文件：
```tsx
it("Enter submits, Shift+Enter inserts newline, IME-composing Enter does not submit", async () => {
  const onSubmit = vi.fn()
  render(<RichComposerEditor value="" onChange={() => {}} onSubmitChord={onSubmit} />)
  const box = screen.getByRole("textbox")
  await userEvent.click(box)
  await userEvent.keyboard("hi")
  // plain Enter -> submit
  await userEvent.keyboard("{Enter}")
  expect(onSubmit).toHaveBeenCalledTimes(1)
  // Shift+Enter -> newline, no submit
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}")
  expect(onSubmit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: FAIL（`onSubmitChord` 未实现）。

- [ ] **Step 3: ImeEnterPlugin**

Create `packages/ui/src/chat/composer/plugins/ImeEnterPlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  INSERT_LINE_BREAK_COMMAND,
} from "lexical"
import { useEffect } from "react"

/**
 * Mirror the old textarea key logic:
 * - IME composing (isComposing / key==="Process") -> let Lexical handle, never submit
 * - Enter / Cmd+Enter / Ctrl+Enter (no Shift, no Alt) -> submit
 * - Shift+Enter -> newline
 */
export function ImeEnterPlugin({
  onSubmitChord,
  onKeyDownExtra,
}: {
  onSubmitChord: () => void
  onKeyDownExtra?: (e: KeyboardEvent) => boolean | void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_ENTER_COMMAND,
      (e) => {
        if (!e) return false
        if (onKeyDownExtra) {
          const swallow = onKeyDownExtra(e)
          if (swallow === true) return true
          if (e.defaultPrevented) return true
        }
        const ne = e as KeyboardEvent & { isComposing?: boolean }
        if (ne.isComposing || e.key === "Process") return false
        const isSendChord =
          (e.metaKey || e.ctrlKey) || (!e.shiftKey && !e.altKey)
        if (!isSendChord) {
          // Shift+Enter -> newline
          e.preventDefault()
          editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)
          return true
        }
        e.preventDefault()
        onSubmitChord()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, onSubmitChord, onKeyDownExtra])
  return null
}
```

- [ ] **Step 4: 接到 editor**

修改 `RichComposerEditor.tsx`：props 增加 `onSubmitChord?: () => void`、`onKeyDownExtra?`；在插件区加 `{onSubmitChord && <ImeEnterPlugin onSubmitChord={onSubmitChord} onKeyDownExtra={onKeyDownExtra} />}`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: all passed。
> 说明：jsdom 下 userEvent 的 Enter 不带 isComposing，IME 分支由后续手测覆盖；此处先验证发送/换行分流。

- [ ] **Step 6: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(ui): composer IME-safe Enter/submit/newline plugin"
```

### Task 2.4: 命令式 handle（focus/select/getTextarea）

**Files:**
- Modify: `RichComposerEditor.tsx`（forwardRef + useImperativeHandle）
- Test: 追加

- [ ] **Step 1: 写测试**

追加：
```tsx
it("exposes focus() imperative handle", async () => {
  const ref = { current: null as null | { focus(): void; select(): void; getTextarea(): unknown } }
  render(<RichComposerEditor ref={ref as never} value="" onChange={() => {}} />)
  expect(typeof ref.current?.focus).toBe("function")
  expect(ref.current?.getTextarea()).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: FAIL（ref 无 focus）。

- [ ] **Step 3: 实现 handle**

修改 `RichComposerEditor.tsx`：用 `forwardRef<RichComposerHandle, RichComposerEditorProps>` 包裹；内部用一个子组件 `<ImperativeHandlePlugin>` 拿 `useLexicalComposerContext` 注册 handle（因为 LexicalComposer 的 context 只在内部可用）：

新增插件 file `packages/ui/src/chat/composer/plugins/ImperativeHandlePlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $setSelection, $createRangeSelection } from "lexical"
import { useImperativeHandle, type Ref } from "react"

export interface RichComposerHandle {
  focus(): void
  select(): void
  getTextarea(): HTMLTextAreaElement | null
}

export function ImperativeHandlePlugin({ handleRef }: { handleRef: Ref<RichComposerHandle> }) {
  const [editor] = useLexicalComposerContext()
  useImperativeHandle(
    handleRef,
    (): RichComposerHandle => ({
      focus: () => editor.focus(),
      select: () =>
        editor.update(() => {
          const root = $getRoot()
          const sel = $createRangeSelection()
          sel.anchor.set(root.getKey(), 0, "element")
          const last = root.getChildAtIndex(root.getChildrenSize() - 1)
          sel.focus.set(root.getKey(), root.getChildrenSize(), "element")
          void last
          $setSelection(sel)
        }),
      // No native textarea anymore; production code never calls this.
      getTextarea: () => null,
    }),
    [editor],
  )
  return null
}
```
在 `RichComposerEditor.tsx`：组件改为 `forwardRef<RichComposerHandle, RichComposerEditorProps>`，并 `export type { RichComposerHandle } from "./plugins/ImperativeHandlePlugin"`；在插件区加 `<ImperativeHandlePlugin handleRef={ref} />`（`ref` 来自 forwardRef 第二参）。Composer 仍保留自己同形状的 `ComposerHandle`，在 Task 2.5 里把它转发到本 handle。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/RichComposerEditor.test.tsx`
Expected: all passed。

- [ ] **Step 5: Commit**
```bash
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -am "feat(ui): composer imperative handle (focus/select)"
```

### Task 2.5: 把 RichComposerEditor 接进 Composer.tsx（替换 textarea）

**Files:**
- Modify: `packages/ui/src/chat/Composer.tsx`
- Test: 手动 typecheck + 现有界面回归

- [ ] **Step 1: 替换 `<Textarea>`**

在 `Composer.tsx`：
- 删除对 `Textarea` 的 import（保留其它 primitives import）。
- 删除 `taRef`、自动撑高 `useLayoutEffect`、`handleKeyDown` 中与原生 textarea 绑定的部分（这些行为已迁到 RichComposerEditor 插件）。保留 `effectiveCanSubmit`、`onSubmit`、`handlePaste` 等逻辑。
- `useImperativeHandle` 改为转发 RichComposerEditor 的 handle：声明 `const innerRef = useRef<RichComposerHandle>(null)`，`useImperativeHandle(ref, () => ({ focus: () => innerRef.current?.focus(), select: () => innerRef.current?.select(), getTextarea: () => innerRef.current?.getTextarea() ?? null }), [])`。
- 用以下替换原 `<Textarea .../>`：
```tsx
<RichComposerEditor
  ref={innerRef}
  value={value}
  onChange={onChange}
  placeholder={resolvedPlaceholder}
  disabled={disabled}
  maxHeightPx={maxTextareaPx}
  style={textareaStyle}
  onSubmitChord={() => {
    if (disabled) return
    if (!effectiveCanSubmit) return
    onSubmit()
  }}
  onKeyDownExtra={onKeyDownExtra as never}
  onPaste={handlePaste}
  className={cn(
    frameVariant === "hero"
      ? "min-h-[3.5rem] px-5 pb-1 pt-3.5"
      : "min-h-9 px-3 py-2",
  )}
/>
```
- import：`import { RichComposerEditor, type RichComposerHandle } from "./composer/RichComposerEditor"`。
- 在 `RichComposerEditor.tsx` 的 `RichComposerEditorProps` 增加 `onPaste?: ClipboardEventHandler<HTMLElement>`，并把它透传到 `<ContentEditable onPaste={onPaste} />`（保留粘贴-转附件能力：附件 hook 的 `handlePaste` 只在 `dataTransfer.types` 含 Files 时拦截，文本粘贴仍交 Lexical）。
> `resolvedPlaceholder` / `effectiveCanSubmit` / `textareaStyle` / `maxTextareaPx` / `onKeyDownExtra` / `handlePaste`（来自 Composer 现有的 `attachments?.handlePaste` 或本地 `handlePaste`）都是 Composer 现有变量，保持不动。打字机占位动画仍由 Composer 现有逻辑算出 `resolvedPlaceholder` 字符串传入。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @hermes-x/ui typecheck`
Expected: 0 errors。（如 onKeyDownExtra 的事件类型不兼容，用 `as never` 暂时桥接，Part 3 收口时统一类型。）

- [ ] **Step 3: 跑全部 ui 测试**

Run: `pnpm --filter @hermes-x/ui test`
Expected: 全绿（含 RichComposerEditor 套件 + smoke）。

- [ ] **Step 4: 手动回归（必须）**

启动桌面 dev：`pnpm dev:desktop`，逐项确认：输入/换行（Shift+Enter）/发送（Enter、Cmd+Enter）/中文 IME 输入回车不误发/粘贴/附件拖拽/快捷动作 chip/麦克风/占位动画/发送停止按钮四态。任何回归记到本 Task 下方并修复后再继续。
启动扩展 dev：`pnpm dev:browser-extension`，侧栏重复关键项（输入/发送/IME/页面上下文按钮不受影响）。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/Composer.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): swap Composer textarea for Lexical RichComposerEditor"
```

---

# Part 3 — 触发系统 + 序列化 + 芯片 + 菜单 + Skills provider

### Task 3.1: provider 类型 + token 序列化/解析（纯函数）

**Files:**
- Create: `packages/ui/src/chat/composer/providers/types.ts`
- Create: `packages/ui/src/chat/composer/serialize.ts`
- Test: `packages/ui/src/chat/composer/__tests__/serialize.test.ts`

- [ ] **Step 1: 写失败测试（往返不丢字符）**

Create `packages/ui/src/chat/composer/__tests__/serialize.test.ts`：
```typescript
import { describe, expect, it } from "vitest"
import { encodeMention, parseTokens } from "../serialize"
import type { MentionData } from "../providers/types"

const skill: MentionData = { type: "skill", payload: { name: "translate" }, display: "translate" }
const session: MentionData = { type: "session", payload: { id: "a1", title: "登录|重构" }, display: "登录|重构" }

describe("token serialize/parse", () => {
  it("encodes each type", () => {
    expect(encodeMention(skill)).toBe("@[skill:translate]")
    // pipe in title is escaped so parsing stays unambiguous
    expect(encodeMention(session)).toBe("@[session:a1|登录%7C重构]")
  })

  it("round-trips mixed text + mentions without losing chars", () => {
    const s = `hi ${encodeMention(skill)} mid ${encodeMention(session)} end`
    const parts = parseTokens(s)
    const rebuilt = parts
      .map((p) => (p.kind === "text" ? p.text : encodeMention(p.mention)))
      .join("")
    expect(rebuilt).toBe(s)
  })

  it("treats unknown @[...] as plain text", () => {
    const parts = parseTokens("see @[bogus:x] here")
    expect(parts.every((p) => p.kind === "text")).toBe(true)
    expect(parts.map((p) => (p.kind === "text" ? p.text : "")).join("")).toBe("see @[bogus:x] here")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/serialize.test.ts`
Expected: FAIL。

- [ ] **Step 3: 类型**

Create `packages/ui/src/chat/composer/providers/types.ts`：
```typescript
import type { ReactNode } from "react"
import type { LexicalEditor } from "lexical"

export type MentionType = "skill" | "session" | "persona" | "channel" | "file" | "page"

export interface MentionData {
  type: MentionType
  payload: Record<string, string>
  display: string
}

export interface MenuItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  insert?: MentionData            // @ 类：插入芯片
  action?: () => void             // slash UI 动作类：选中即执行
  raw?: string                    // slash 文本类：插入的命令文本
  subcommands?: string[]          // slash：进入二级补全
}

export interface TriggerProvider {
  trigger: "/" | "@"
  id: string
  group?: string
  match(query: string): boolean | number
  search(query: string): Promise<MenuItem[]>
  onSelect(item: MenuItem, editor: LexicalEditor): void
  serialize?(mention: MentionData): string
}
```

- [ ] **Step 4: 序列化实现**

Create `packages/ui/src/chat/composer/serialize.ts`：
```typescript
import type { MentionData, MentionType } from "./providers/types"

const KNOWN: MentionType[] = ["skill", "session", "persona", "channel", "file", "page"]
const TOKEN_RE = /@\[([a-z]+):((?:[^\]\\]|\\.)*)\]/g

// payload field order per type for the colon/pipe body
const FIELDS: Record<MentionType, string[]> = {
  skill: ["name"],
  session: ["id", "title"],
  persona: ["key"],
  channel: ["id"],
  file: ["path"],
  page: ["tabId", "title"], // page may have no fields -> "@[page:]"
}

function esc(v: string): string {
  // escape pipe + closing bracket so the body parses unambiguously
  return v.replace(/%/g, "%25").replace(/\|/g, "%7C").replace(/\]/g, "%5D")
}
function unesc(v: string): string {
  return v.replace(/%5D/g, "]").replace(/%7C/g, "|").replace(/%25/g, "%")
}

export function encodeMention(m: MentionData): string {
  const fields = FIELDS[m.type] ?? []
  const body = fields.map((f) => esc(m.payload[f] ?? "")).join("|")
  return `@[${m.type}:${body}]`
}

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; mention: MentionData; raw: string }

function decode(type: string, body: string): MentionData | null {
  if (!KNOWN.includes(type as MentionType)) return null
  const t = type as MentionType
  const fields = FIELDS[t]
  const parts = body.length ? body.split("|") : []
  const payload: Record<string, string> = {}
  fields.forEach((f, i) => { payload[f] = unesc(parts[i] ?? "") })
  const display =
    payload.title || payload.name || payload.key || payload.path || payload.id || t
  return { type: t, payload, display }
}

export function parseTokens(value: string): ParsedPart[] {
  const out: ParsedPart[] = []
  let last = 0
  for (const match of value.matchAll(TOKEN_RE)) {
    const [raw, type, body] = match
    const start = match.index ?? 0
    const mention = decode(type, body)
    if (!mention) continue // unknown -> leave inside following text slice
    if (start > last) out.push({ kind: "text", text: value.slice(last, start) })
    out.push({ kind: "mention", mention, raw })
    last = start + raw.length
  }
  if (last < value.length) out.push({ kind: "text", text: value.slice(last) })
  return out.length ? out : [{ kind: "text", text: value }]
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/serialize.test.ts`
Expected: 3 passed。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/composer/providers/types.ts packages/ui/src/chat/composer/serialize.ts packages/ui/src/chat/composer/__tests__/serialize.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): composer mention token serialize/parse"
```

### Task 3.2: MentionNode（芯片节点）

**Files:**
- Create: `packages/ui/src/chat/composer/MentionNode.tsx`
- Test: `packages/ui/src/chat/composer/__tests__/MentionNode.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `packages/ui/src/chat/composer/__tests__/MentionNode.test.tsx`：
```tsx
import { describe, expect, it } from "vitest"
import { $createMentionNode, $isMentionNode, MentionNode } from "../MentionNode"

describe("MentionNode", () => {
  it("constructs and exposes its mention data + text", () => {
    const node = $createMentionNode({ type: "skill", payload: { name: "translate" }, display: "translate" })
    expect($isMentionNode(node)).toBe(true)
    expect(node.getMention().payload.name).toBe("translate")
    expect(node.getTextContent()).toBe("@[skill:translate]")
  })

  it("serializes/deserializes JSON", () => {
    const node = $createMentionNode({ type: "channel", payload: { id: "cli" }, display: "cli" })
    const json = node.exportJSON()
    const back = MentionNode.importJSON(json)
    expect(back.getMention().payload.id).toBe("cli")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/MentionNode.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 MentionNode（DecoratorNode）**

Create `packages/ui/src/chat/composer/MentionNode.tsx`：
```tsx
import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical"
import type { JSX } from "react"
import { encodeMention } from "./serialize"
import type { MentionData } from "./providers/types"
import { cn } from "../../primitives"

export type SerializedMentionNode = Spread<{ mention: MentionData }, SerializedLexicalNode>

export class MentionNode extends DecoratorNode<JSX.Element> {
  __mention: MentionData

  static getType(): string { return "hermes-mention" }
  static clone(node: MentionNode): MentionNode { return new MentionNode(node.__mention, node.__key) }

  constructor(mention: MentionData, key?: NodeKey) {
    super(key)
    this.__mention = mention
  }

  getMention(): MentionData { return this.__mention }

  // Serialized text form == the canonical token, so getRoot().getTextContent()
  // yields the value string with tokens inline.
  getTextContent(): string { return encodeMention(this.__mention) }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.style.display = "inline-block"
    return span
  }
  updateDOM(): false { return false }
  isInline(): true { return true }

  exportJSON(): SerializedMentionNode {
    return { type: MentionNode.getType(), version: 1, mention: this.__mention }
  }
  static importJSON(json: SerializedMentionNode): MentionNode {
    return new MentionNode(json.mention)
  }

  decorate(): JSX.Element {
    const m = this.__mention
    return (
      <span
        className={cn(
          "inline-flex h-5 items-center rounded-md border border-border bg-muted/50 px-1 align-baseline text-[12px] text-foreground",
        )}
        data-mention-type={m.type}
        contentEditable={false}
      >
        @{m.display}
      </span>
    )
  }
}

export function $createMentionNode(mention: MentionData): MentionNode {
  return new MentionNode(mention)
}
export function $isMentionNode(node: unknown): node is MentionNode {
  return node instanceof MentionNode
}
```

- [ ] **Step 4: 注册节点**

修改 `lexical-config.ts`：`import { MentionNode } from "./MentionNode"`，把 `nodes: []` 改为 `nodes: [MentionNode]`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/MentionNode.test.tsx`
Expected: 2 passed。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/composer/MentionNode.tsx packages/ui/src/chat/composer/lexical-config.ts packages/ui/src/chat/composer/__tests__/MentionNode.test.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): MentionNode chip + token text content"
```

### Task 3.3: MentionSerializePlugin（节点树 ↔ value 串，替换 ValueSyncPlugin）

**Files:**
- Create: `packages/ui/src/chat/composer/plugins/MentionSerializePlugin.tsx`
- Modify: `RichComposerEditor.tsx`（用它替换 ValueSyncPlugin）
- Test: `packages/ui/src/chat/composer/__tests__/MentionSerialize.test.tsx`

- [ ] **Step 1: 写失败测试（外部含 token 的 value → 渲染出芯片；编辑 → 串回写）**

Create `packages/ui/src/chat/composer/__tests__/MentionSerialize.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RichComposerEditor } from "../RichComposerEditor"

describe("mention value sync", () => {
  it("renders a chip for a token in the external value", () => {
    render(<RichComposerEditor value="hi @[skill:translate] x" onChange={() => {}} />)
    expect(screen.getByText("@translate")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/MentionSerialize.test.tsx`
Expected: FAIL（无芯片，ValueSyncPlugin 只渲染纯文本）。

- [ ] **Step 3: 实现 MentionSerializePlugin**

Create `packages/ui/src/chat/composer/plugins/MentionSerializePlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical"
import { useEffect, useRef } from "react"
import { $createMentionNode } from "../MentionNode"
import { parseTokens } from "../serialize"

/** Two-way sync between Lexical (text + MentionNode) and the canonical value string. */
export function MentionSerializePlugin({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const lastEmitted = useRef<string | null>(null)

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent() // MentionNode.getTextContent == token
        if (text !== lastEmitted.current) {
          lastEmitted.current = text
          onChange(text)
        }
      })
    })
  }, [editor, onChange])

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      for (const part of parseTokens(value)) {
        if (part.kind === "text") {
          if (part.text) p.append($createTextNode(part.text))
        } else {
          p.append($createMentionNode(part.mention))
        }
      }
      root.append(p)
    })
  }, [editor, value])

  return null
}
```

- [ ] **Step 4: 替换 ValueSyncPlugin**

修改 `RichComposerEditor.tsx`：把 `<ValueSyncPlugin .../>` 换成 `<MentionSerializePlugin value={value} onChange={onChange} />`；删除 ValueSyncPlugin import（文件可保留以备 fallback，但不再使用）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/MentionSerialize.test.tsx`
并跑回归：`pnpm --filter @hermes-x/ui test`
Expected: 全绿（纯文本往返仍通过，新增芯片渲染通过）。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/composer/plugins/MentionSerializePlugin.tsx packages/ui/src/chat/composer/RichComposerEditor.tsx packages/ui/src/chat/composer/__tests__/MentionSerialize.test.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): node<->value sync with MentionNode chips"
```

### Task 3.4: TriggerPlugin（检测 `/` 行首与 `@` 任意位置，维护 query）

**Files:**
- Create: `packages/ui/src/chat/composer/plugins/TriggerPlugin.tsx`
- Test: `packages/ui/src/chat/composer/__tests__/trigger-detect.test.ts`

- [ ] **Step 1: 写失败测试（纯检测函数）**

Create `packages/ui/src/chat/composer/__tests__/trigger-detect.test.ts`：
```typescript
import { describe, expect, it } from "vitest"
import { detectTrigger } from "../plugins/TriggerPlugin"

describe("detectTrigger", () => {
  it("detects @ anywhere with the query after it", () => {
    expect(detectTrigger("hello @tr", 9)).toEqual({ trigger: "@", query: "tr", start: 6 })
  })
  it("detects / only at line start", () => {
    expect(detectTrigger("/mod", 4)).toEqual({ trigger: "/", query: "mod", start: 0 })
    expect(detectTrigger("hi /mod", 7)).toBeNull() // not line start
  })
  it("closes when whitespace follows trigger", () => {
    expect(detectTrigger("@skill done", 11)).toBeNull()
  })
  it("returns null with no trigger", () => {
    expect(detectTrigger("plain text", 10)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/trigger-detect.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 detectTrigger + 插件**

Create `packages/ui/src/chat/composer/plugins/TriggerPlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getSelection, $isRangeSelection } from "lexical"
import { useEffect } from "react"

export interface TriggerState {
  trigger: "/" | "@"
  query: string
  start: number // index of the trigger char within the current text run
}

/** Pure detector: given the text before the caret, find an open trigger.
 *  Slash is line-anchored and its query spans the whole line (so multi-word
 *  subcommands like "/reasoning low" keep the menu open). @ stops at whitespace. */
export function detectTrigger(textToCaret: string, _caret: number): TriggerState | null {
  const slashLine = /^\/([^\n]*)$/.exec(textToCaret)
  if (slashLine) {
    return { trigger: "/", query: slashLine[1], start: 0 }
  }
  const m = /(^|\s)(@)([^\s]*)$/.exec(textToCaret)
  if (!m) return null
  const query = m[3]
  const start = textToCaret.length - query.length - 1
  return { trigger: "@", query, start }
}

export function TriggerPlugin({ onTrigger }: { onTrigger: (s: TriggerState | null) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) { onTrigger(null); return }
        const node = sel.anchor.getNode()
        const offset = sel.anchor.offset
        const textToCaret = node.getTextContent().slice(0, offset)
        onTrigger(detectTrigger(textToCaret, offset))
      })
    })
  }, [editor, onTrigger])
  return null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/trigger-detect.test.ts`
Expected: 4 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/composer/plugins/TriggerPlugin.tsx packages/ui/src/chat/composer/__tests__/trigger-detect.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): trigger detection plugin for / and @"
```

### Task 3.5: TriggerMenu（候选列表 + 键盘导航 + 空/错误态）

**Files:**
- Create: `packages/ui/src/chat/composer/TriggerMenu.tsx`
- Test: `packages/ui/src/chat/composer/__tests__/TriggerMenu.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `packages/ui/src/chat/composer/__tests__/TriggerMenu.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TriggerMenu } from "../TriggerMenu"
import type { MenuItem } from "../providers/types"

const items: MenuItem[] = [
  { id: "a", label: "translate" },
  { id: "b", label: "summarize" },
]

describe("TriggerMenu", () => {
  it("renders items and selects on Enter", async () => {
    const onSelect = vi.fn()
    render(<TriggerMenu items={items} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />)
    expect(screen.getByText("translate")).toBeInTheDocument()
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it("shows empty state", () => {
    render(<TriggerMenu items={[]} loading={false} error={null} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it("shows error state", () => {
    render(<TriggerMenu items={[]} loading={false} error="boom" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/TriggerMenu.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 TriggerMenu**

Create `packages/ui/src/chat/composer/TriggerMenu.tsx`：
```tsx
import { useEffect, useState } from "react"
import { cn } from "../../primitives"
import type { MenuItem } from "./providers/types"

export interface TriggerMenuProps {
  items: MenuItem[]
  loading: boolean
  error: string | null
  onSelect: (item: MenuItem) => void
  onClose: () => void
  anchorClassName?: string
}

export function TriggerMenu({ items, loading, error, onSelect, onClose, anchorClassName }: TriggerMenuProps) {
  const [active, setActive] = useState(0)
  useEffect(() => { setActive(0) }, [items])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
      else if (e.key === "Enter") { if (items[active]) { e.preventDefault(); onSelect(items[active]) } }
      else if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [items, active, onSelect, onClose])

  return (
    <div className={cn(
      "absolute left-0 right-0 bottom-full z-50 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
      anchorClassName,
    )}>
      {loading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="px-2 py-1.5 text-xs text-destructive">Failed to load</div>}
      {!loading && !error && items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseEnter={() => setActive(i)}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
            i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
        >
          {item.icon}
          <span className="truncate">{item.label}</span>
          {item.description && <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/TriggerMenu.test.tsx`
Expected: 3 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/composer/TriggerMenu.tsx packages/ui/src/chat/composer/__tests__/TriggerMenu.test.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): TriggerMenu with keyboard nav + empty/error states"
```

### Task 3.6: Skills provider + registry + 端到端接线（插入芯片）

**Files:**
- Create: `packages/ui/src/chat/composer/providers/skills.ts`、`providers/registry.ts`
- Create: `packages/ui/src/chat/composer/plugins/MentionInsert.ts`（在 editor 内把当前 query 替换成芯片的工具）
- Modify: `RichComposerEditor.tsx`（接入 TriggerPlugin + TriggerMenu + providers）
- Test: `packages/ui/src/chat/composer/__tests__/skills-provider.test.ts`

- [ ] **Step 1: 写失败测试（provider 单测）**

Create `packages/ui/src/chat/composer/__tests__/skills-provider.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSkillsProvider } from "../providers/skills"

vi.mock("@hermes-x/core", () => ({
  getHermesSkills: vi.fn().mockResolvedValue({
    ok: true,
    skills: [
      { name: "translate", description: "Translate text", enabled: true },
      { name: "summarize", description: "Summarize", enabled: true },
    ],
  }),
}))

describe("skills provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("searches by query and returns MenuItems with skill mentions", async () => {
    const p = makeSkillsProvider()
    const items = await p.search("trans")
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("translate")
    expect(items[0].insert).toEqual({ type: "skill", payload: { name: "translate" }, display: "translate" })
  })
  it("serializes a skill mention for sending", () => {
    const p = makeSkillsProvider()
    expect(p.serialize?.({ type: "skill", payload: { name: "translate" }, display: "translate" }))
      .toContain("translate")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/skills-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: Skills provider**

Create `packages/ui/src/chat/composer/providers/skills.ts`：
```typescript
import { getHermesSkills } from "@hermes-x/core"
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical"
import { $createMentionNode } from "../MentionNode"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

let cache: { name: string; description: string }[] | null = null

async function load() {
  if (cache) return cache
  const res = await getHermesSkills()
  cache = res.ok ? res.skills.filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description })) : []
  return cache
}

export function makeSkillsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "skills",
    group: "Skills",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const skills = await load()
      return skills
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((s) => ({
          id: `skill:${s.name}`,
          label: s.name,
          description: s.description,
          insert: { type: "skill", payload: { name: s.name }, display: s.name } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (!item.insert) return
      insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(skill: ${m.payload.name})`
    },
  }
}

/** Replace the open trigger run (e.g. "@trans") with a MentionNode + trailing space. */
export function insertMentionAtTrigger(editor: LexicalEditor, mention: MentionData) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const offset = sel.anchor.offset
    const text = node.getTextContent()
    const before = text.slice(0, offset)
    const m = /([/@])([^\s]*)$/.exec(before)
    if (!m) return
    const triggerStart = offset - m[0].length
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      // remove the "@query" run
      ;(node as unknown as { spliceText: (i: number, n: number, t: string) => void }).spliceText(
        triggerStart, m[0].length, "",
      )
    }
    const chip = $createMentionNode(mention)
    sel.insertNodes([chip])
    sel.insertText(" ")
  })
}
```
> `insertMentionAtTrigger` 抽成可复用工具，后续 sessions/personas/channels/files/page provider 共用。

- [ ] **Step 4: registry**

Create `packages/ui/src/chat/composer/providers/registry.ts`：
```typescript
import type { TriggerProvider } from "./types"
import { makeSkillsProvider } from "./skills"

export interface ProviderRegistry {
  all: TriggerProvider[]
  forTrigger(trigger: "/" | "@"): TriggerProvider[]
}

export function buildProviderRegistry(extra: TriggerProvider[] = []): ProviderRegistry {
  const builtin: TriggerProvider[] = [makeSkillsProvider()]
  const all = [...builtin, ...extra]
  return {
    all,
    forTrigger: (trigger) => all.filter((p) => p.trigger === trigger),
  }
}
```
> 后续 Task（4.2/4.3/4.4/4.5）把 `makeSlashProvider()`/`makeSessionsProvider()`/`makePersonasProvider()`/`makeChannelsProvider()` 追加进 `builtin` 数组。`all` 字段供发送层 `expandMentions` 取「全部 provider（含注入）」。

- [ ] **Step 5: 接线进 RichComposerEditor**

修改 `RichComposerEditor.tsx`：
- props 增加 `mentionProviders?: TriggerProvider[]`。
- 内部用一个新插件组件 `<TriggerMenuPlugin>`（拿 context、维护 trigger state、调用 provider.search、渲染 `<TriggerMenu>`、onSelect 调 provider.onSelect）。把它放进编辑器内、`<div className="relative">` 里。

Create `packages/ui/src/chat/composer/plugins/TriggerMenuPlugin.tsx`：
```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useEffect, useMemo, useState } from "react"
import { TriggerMenu } from "../TriggerMenu"
import { TriggerPlugin, type TriggerState } from "./TriggerPlugin"
import { buildProviderRegistry } from "../providers/registry"
import type { MenuItem, TriggerProvider } from "../providers/types"

export function TriggerMenuPlugin({ extraProviders }: { extraProviders?: TriggerProvider[] }) {
  const [editor] = useLexicalComposerContext()
  const registry = useMemo(() => buildProviderRegistry(extraProviders ?? []), [extraProviders])
  const [state, setState] = useState<TriggerState | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!state) { setItems([]); setError(null); return }
    const providers = registry.forTrigger(state.trigger).filter((p) => p.match(state.query) !== false)
    setLoading(true); setError(null)
    Promise.all(providers.map((p) => p.search(state.query).catch(() => { throw p.id })))
      .then((lists) => { if (!cancelled) setItems(lists.flat()) })
      .catch(() => { if (!cancelled) setError("error") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [state, registry])

  function handleSelect(item: MenuItem) {
    const providers = registry.forTrigger(state?.trigger ?? "@")
    const owner = providers.find((p) => p.search && item.id.startsWith(`${p.id}:`)) ?? providers[0]
    owner?.onSelect(item, editor)
    setState(null)
  }

  return (
    <>
      <TriggerPlugin onTrigger={setState} />
      {state && (
        <TriggerMenu
          items={items}
          loading={loading}
          error={error}
          onSelect={handleSelect}
          onClose={() => setState(null)}
        />
      )}
    </>
  )
}
```
在 `RichComposerEditor.tsx` 插件区加 `<TriggerMenuPlugin extraProviders={mentionProviders} />`。

- [ ] **Step 6: 跑 provider 单测 + 全量回归**

Run: `pnpm --filter @hermes-x/ui test`
Expected: 全绿。

- [ ] **Step 7: 手动验证**

`pnpm dev:desktop`：输入 `@tr` → 出现菜单含 translate → Enter → 变成芯片 `@translate` + 空格。删除芯片整体消失。

- [ ] **Step 8: Commit**
```bash
git add packages/ui/src/chat/composer/
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): @skill mentions end-to-end (provider+menu+chip insert)"
```

---

# Part 4 — 其余内置 provider + 发送展开

### Task 4.1: expandMentions（发送时展开 token → 文本）

**Files:**
- Create: `packages/ui/src/chat/composer/expandMentions.ts`
- Test: `packages/ui/src/chat/composer/__tests__/expandMentions.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/ui/src/chat/composer/__tests__/expandMentions.test.ts`：
```typescript
import { describe, expect, it } from "vitest"
import { expandMentions } from "../expandMentions"
import type { TriggerProvider } from "../providers/types"

const skills = {
  trigger: "@", id: "skills",
  match: () => true, search: async () => [], onSelect: () => {},
  serialize: (m) => `(skill: ${m.payload.name})`,
} as unknown as TriggerProvider

describe("expandMentions", () => {
  it("replaces tokens via provider.serialize, keeps plain text", () => {
    const out = expandMentions("hi @[skill:translate] there", [skills])
    expect(out).toBe("hi (skill: translate) there")
  })
  it("leaves text untouched when no provider serializes a type", () => {
    const out = expandMentions("x @[persona:concise] y", [skills])
    expect(out).toContain("@[persona:concise]") // unhandled -> raw kept
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/expandMentions.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `packages/ui/src/chat/composer/expandMentions.ts`：
```typescript
import { parseTokens } from "./serialize"
import type { MentionType, TriggerProvider } from "./providers/types"

export function expandMentions(value: string, providers: TriggerProvider[]): string {
  // Index serializing providers by the mention type they own.
  const byType = new Map<MentionType, TriggerProvider>()
  for (const p of providers) {
    if (p.serialize && p.ownsType && !byType.has(p.ownsType)) {
      byType.set(p.ownsType, p)
    }
  }
  return parseTokens(value)
    .map((part) => {
      if (part.kind === "text") return part.text
      const p = byType.get(part.mention.type)
      return p?.serialize ? p.serialize(part.mention) : part.raw
    })
    .join("")
}
```
> 本 Task 需给 `TriggerProvider`（`types.ts`）接口加可选字段 `ownsType?: MentionType`，各 @ provider 设置自己拥有的 type（skills 加 `ownsType: "skill"`）。本 Task 测试里的 `skills` 桩对象也要加 `ownsType: "skill"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/expandMentions.test.ts`
Expected: 2 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/composer/expandMentions.ts packages/ui/src/chat/composer/providers/types.ts packages/ui/src/chat/composer/providers/skills.ts packages/ui/src/chat/composer/__tests__/expandMentions.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): expandMentions send-time token expansion"
```

### Task 4.2: Slash provider（命令 + subcommand + UI 动作覆盖）+ 命令路由

**Files:**
- Create: `packages/ui/src/chat/composer/providers/slash-ui-actions.ts`、`providers/slash.ts`
- Modify: `providers/registry.ts`（注册 slash）
- Modify: `packages/ui/src/chat/Composer.tsx`（onSubmit 命令路由 + expandMentions）
- Test: `packages/ui/src/chat/composer/__tests__/slash-provider.test.ts`、`command-routing.test.ts`

- [ ] **Step 1: 写失败测试（provider）**

Create `packages/ui/src/chat/composer/__tests__/slash-provider.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSlashProvider } from "../providers/slash"

vi.mock("@hermes-x/core", () => ({
  getHermesCommands: vi.fn().mockResolvedValue({
    ok: true,
    commands: [
      { name: "model", description: "Switch model", category: "Configuration", aliases: ["provider"], args_hint: "[model]", subcommands: [] },
      { name: "reasoning", description: "Effort", category: "Configuration", aliases: [], args_hint: "[level]", subcommands: ["low", "high"] },
    ],
  }),
}))

describe("slash provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("lists commands matching query, including alias match", async () => {
    const p = makeSlashProvider()
    const items = await p.search("prov")
    expect(items.some((i) => i.label === "model")).toBe(true)
  })
  it("exposes subcommands for two-level completion", async () => {
    const p = makeSlashProvider()
    const items = await p.search("reasoning")
    const reasoning = items.find((i) => i.label === "reasoning")
    expect(reasoning?.subcommands).toEqual(["low", "high"])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/slash-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: UI 动作覆盖表 + slash provider**

Create `packages/ui/src/chat/composer/providers/slash-ui-actions.ts`：
```typescript
/** The small set of commands that map to a native UI action instead of being
 *  sent as text. Everything else defaults to kind:'send'. Host wires handlers. */
export type SlashKind = "send" | "ui-action"

export interface SlashUiActionContext {
  openSettings?: () => void
}

export function slashKindFor(name: string): SlashKind {
  return UI_ACTION_NAMES.has(name) ? "ui-action" : "send"
}

export const UI_ACTION_NAMES = new Set<string>([
  // Extend as native UI surfaces are added. Keep tiny.
  "config",
])

export function runUiAction(name: string, ctx: SlashUiActionContext): boolean {
  if (name === "config") { ctx.openSettings?.(); return true }
  return false
}
```

Create `packages/ui/src/chat/composer/providers/slash.ts`：
```typescript
import { getHermesCommands } from "@hermes-x/core"
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical"
import type { MenuItem, TriggerProvider } from "./types"
import { slashKindFor } from "./slash-ui-actions"

let cache: { name: string; description: string; aliases: string[]; subcommands: string[] }[] | null = null
async function load() {
  if (cache) return cache
  const res = await getHermesCommands()
  cache = res.ok
    ? res.commands.map((c) => ({ name: c.name, description: c.description, aliases: c.aliases, subcommands: c.subcommands }))
    : []
  return cache
}

export function makeSlashProvider(): TriggerProvider {
  return {
    trigger: "/",
    id: "slash",
    group: "Commands",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const cmds = await load()
      return cmds
        .filter((c) => c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)))
        .slice(0, 30)
        .map((c) => ({
          id: `slash:${c.name}`,
          label: c.name,
          description: c.description,
          raw: `/${c.name} `,
          subcommands: c.subcommands.length ? c.subcommands : undefined,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      replaceLineWith(editor, item.raw ?? `/${item.label} `)
    },
  }
}

/** Replace the current line's "/query" with the chosen command text. */
function replaceLineWith(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const offset = sel.anchor.offset
    const before = node.getTextContent().slice(0, offset)
    const m = /\/([^\s]*)$/.exec(before)
    if (!m) return
    const start = offset - m[0].length
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      ;(node as unknown as { spliceText: (i: number, n: number, t: string) => void }).spliceText(start, m[0].length, text)
    }
  })
}

export { slashKindFor }
```

- [ ] **Step 4: 注册到 registry + 跑 provider 测试**

修改 `providers/registry.ts`：`import { makeSlashProvider } from "./slash"`，`builtin` 数组加 `makeSlashProvider()`。
Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/slash-provider.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 命令路由测试**

Create `packages/ui/src/chat/composer/__tests__/command-routing.test.ts`：
```typescript
import { describe, expect, it, vi } from "vitest"
import { routeSubmit } from "../command-routing"

describe("routeSubmit", () => {
  it("ui-action command triggers action, not send", () => {
    const send = vi.fn(); const openSettings = vi.fn()
    const handled = routeSubmit("/config", { send, ctx: { openSettings } })
    expect(handled).toBe(true)
    expect(openSettings).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it("send command goes to send as-is", () => {
    const send = vi.fn()
    const handled = routeSubmit("/model gpt-4", { send, ctx: {} })
    expect(handled).toBe(false) // not intercepted; caller sends finalText
  })
  it("non-command returns false", () => {
    const send = vi.fn()
    expect(routeSubmit("hello", { send, ctx: {} })).toBe(false)
  })
})
```

Create `packages/ui/src/chat/composer/command-routing.ts`：
```typescript
import { runUiAction, slashKindFor, type SlashUiActionContext } from "./providers/slash-ui-actions"

/** Returns true if the submit was fully handled (UI action). False means the
 *  caller should proceed with normal send (text command or plain message). */
export function routeSubmit(
  value: string,
  opts: { send: (text: string) => void; ctx: SlashUiActionContext },
): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) return false
  const name = trimmed.slice(1).split(/\s+/)[0]
  if (slashKindFor(name) === "ui-action") {
    return runUiAction(name, opts.ctx)
  }
  return false
}
```

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/command-routing.test.ts`
Expected: 3 passed。

- [ ] **Step 6: 接进 Composer.onSubmit**

修改 `Composer.tsx`：新增可选 prop `slashUiActions?: SlashUiActionContext`、`mentionProviders?`（透传给 RichComposerEditor）。在调用 `onSubmit()` 之前包一层：
```tsx
function handleSend(overrideText?: string) {
  const text = overrideText ?? value
  if (routeSubmit(text, { send: () => {}, ctx: slashUiActions ?? {} })) return // UI action handled
  const finalText = expandMentions(text, allProviders) // allProviders = builtin + injected
  onSubmit(finalText)
}
```
把原先直接调用 `onSubmit()` 的发送路径(发送按钮、`onSubmitChord`)改为调用 `handleSend()`。
> `onSubmit` 已支持 `overrideText`（见 spec / 现有签名 `(overrideText?: string) => void`），故传 `finalText` 兼容。`allProviders` 可由 `buildProviderRegistry(mentionProviders)` 暴露一个 `all()` 方法获得，或在 registry 增加 `all: TriggerProvider[]` 字段；本步在 `registry.ts` 增加 `all` 字段并在 Composer 用它。

- [ ] **Step 7: typecheck + 全量测试 + 手测**

Run: `pnpm --filter @hermes-x/ui typecheck && pnpm --filter @hermes-x/ui test`
Expected: 全绿。
手测：行首输入 `/mod` → 菜单含 model → 选中插入 `/model ` 文本；发送 `/model xxx` 整行发出；`@translate` 芯片发送时展开成 `(skill: translate)`。

- [ ] **Step 8: Commit**
```bash
git add packages/ui/src/chat/composer/ packages/ui/src/chat/Composer.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): slash provider + command routing + send expansion"
```

### Task 4.2.1: Slash 二级 subcommand 补全（`/reasoning ` → `low/medium/high`）

**Files:**
- Modify: `packages/ui/src/chat/composer/providers/slash.ts`（search 处理 "cmd sub"；replaceLineWith 替换整行）
- Test: 追加 `packages/ui/src/chat/composer/__tests__/slash-provider.test.ts` 与 `trigger-detect.test.ts`

> 前置：Task 3.4 的 `detectTrigger` 已让 `/` 触发的 query 覆盖整行（含空格），所以 `/reasoning low` 不会在空格处关闭菜单。

- [ ] **Step 1: 写失败测试**

在 `trigger-detect.test.ts` 追加：
```typescript
it("slash query spans whole line incl. spaces", () => {
  expect(detectTrigger("/reasoning lo", 13)).toEqual({ trigger: "/", query: "reasoning lo", start: 0 })
})
```
在 `slash-provider.test.ts` 追加：
```typescript
it("offers subcommand items when query has 'cmd sub'", async () => {
  const p = makeSlashProvider()
  const items = await p.search("reasoning hi")
  expect(items).toHaveLength(1)
  expect(items[0].label).toBe("high")
  expect(items[0].raw).toBe("/reasoning high ")
})
it("returns empty for a command without subcommands at second level", async () => {
  const p = makeSlashProvider()
  expect(await p.search("model foo")).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/slash-provider.test.ts src/chat/composer/__tests__/trigger-detect.test.ts`
Expected: 新增用例 FAIL（一级 search 把 "reasoning hi" 当名字过滤，返回空或错配）。

- [ ] **Step 3: 实现二级分支 + 整行替换**

修改 `providers/slash.ts` 的 `search`，在函数体最前面加二级分支：
```typescript
    async search(query: string): Promise<MenuItem[]> {
      const cmds = await load()
      const spaceIdx = query.indexOf(" ")
      if (spaceIdx >= 0) {
        const cmdName = query.slice(0, spaceIdx)
        const subQuery = query.slice(spaceIdx + 1).toLowerCase()
        const cmd = cmds.find((c) => c.name === cmdName || c.aliases.includes(cmdName))
        if (!cmd || cmd.subcommands.length === 0) return []
        return cmd.subcommands
          .filter((s) => s.toLowerCase().includes(subQuery))
          .map((s) => ({
            id: `slash:${cmd.name}:${s}`,
            label: s,
            description: cmd.name,
            raw: `/${cmd.name} ${s} `,
          }))
      }
      const q = query.toLowerCase()
      return cmds
        .filter((c) => c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)))
        .slice(0, 30)
        .map((c) => ({
          id: `slash:${c.name}`,
          label: c.name,
          description: c.description,
          raw: `/${c.name} `,
          subcommands: c.subcommands.length ? c.subcommands : undefined,
        }))
    },
```
并把 `replaceLineWith` 的匹配从「到首个空格」改为「整行」，这样二级选中能替换 `/reasoning lo` → `/reasoning low `：
```typescript
function replaceLineWith(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const offset = sel.anchor.offset
    const before = node.getTextContent().slice(0, offset)
    const m = /\/[^\n]*$/.exec(before) // whole line from the leading slash
    if (!m) return
    const start = offset - m[0].length
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      ;(node as unknown as { spliceText: (i: number, n: number, t: string) => void }).spliceText(start, m[0].length, text)
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/slash-provider.test.ts src/chat/composer/__tests__/trigger-detect.test.ts`
Expected: 全部 passed。

- [ ] **Step 5: 手测**

`pnpm dev:desktop`：输入 `/reasoning ` → 菜单出现 `low/medium/high/...`；继续输入 `h` 过滤到 `high`；Enter → 整行变 `/reasoning high `；发送整行发后端。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/composer/providers/slash.ts packages/ui/src/chat/composer/__tests__/
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): slash second-level subcommand completion"
```

### Task 4.3: Sessions provider

**Files:**
- Create: `packages/ui/src/chat/composer/providers/sessions.ts`
- Modify: `providers/registry.ts`
- Test: `packages/ui/src/chat/composer/__tests__/sessions-provider.test.ts`

- [ ] **Step 1: 写失败测试**
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSessionsProvider } from "../providers/sessions"

vi.mock("@hermes-x/core", () => ({
  listHermesSessions: vi.fn().mockResolvedValue({
    sessions: [{ id: "a1", title: "登录重构", updated_at: "2026-06-01" }],
  }),
}))

describe("sessions provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns session mentions", async () => {
    const items = await makeSessionsProvider().search("登录")
    expect(items[0].insert).toEqual({ type: "session", payload: { id: "a1", title: "登录重构" }, display: "登录重构" })
  })
})
```
Create at `packages/ui/src/chat/composer/__tests__/sessions-provider.test.ts`.

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/sessions-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `packages/ui/src/chat/composer/providers/sessions.ts`：
```typescript
import { listHermesSessions } from "@hermes-x/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

export function makeSessionsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "sessions",
    group: "Sessions",
    ownsType: "session",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const res = await listHermesSessions({})
      const sessions = "sessions" in res ? res.sessions : []
      const q = query.toLowerCase()
      return sessions
        .filter((s) => (s.title ?? "").toLowerCase().includes(q))
        .slice(0, 15)
        .map((s) => ({
          id: `sessions:${s.id}`,
          label: s.title || s.id,
          insert: { type: "session", payload: { id: s.id, title: s.title ?? "" }, display: s.title || s.id } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(session: ${m.payload.title || m.payload.id})`
    },
  }
}
```
> `ownsType` 字段已在 Task 4.1 加入 `TriggerProvider`。`listHermesSessions` 返回可能是 `ListSessionsResponse | HermesError`，用 `"sessions" in res` 收窄。

- [ ] **Step 4: 注册 + 跑测试通过**

`registry.ts` builtin 加 `makeSessionsProvider()`。
Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/sessions-provider.test.ts`
Expected: 1 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/composer/providers/sessions.ts packages/ui/src/chat/composer/providers/registry.ts packages/ui/src/chat/composer/__tests__/sessions-provider.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): @session mentions provider"
```

### Task 4.4: Personas provider

**Files:**
- Create: `packages/ui/src/chat/composer/providers/personas.ts`
- Modify: `providers/registry.ts`
- Test: `packages/ui/src/chat/composer/__tests__/personas-provider.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/ui/src/chat/composer/__tests__/personas-provider.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { makePersonasProvider } from "../providers/personas"

vi.mock("@hermes-x/core", () => ({
  getHermesPersonalities: vi.fn().mockResolvedValue({
    ok: true,
    personalities: [{ key: "concise", builtin: true, preview: "Keep it brief" }],
  }),
}))

describe("personas provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns persona mentions", async () => {
    const items = await makePersonasProvider().search("conc")
    expect(items[0].insert).toEqual({ type: "persona", payload: { key: "concise" }, display: "concise" })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/personas-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `packages/ui/src/chat/composer/providers/personas.ts`：
```typescript
import { getHermesPersonalities } from "@hermes-x/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

let cache: { key: string; preview: string }[] | null = null
async function load() {
  if (cache) return cache
  const res = await getHermesPersonalities()
  cache = res.ok ? res.personalities.map((p) => ({ key: p.key, preview: p.preview })) : []
  return cache
}

export function makePersonasProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "personas",
    group: "Personas",
    ownsType: "persona",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const list = await load()
      return list
        .filter((p) => p.key.toLowerCase().includes(q))
        .slice(0, 15)
        .map((p) => ({
          id: `personas:${p.key}`,
          label: p.key,
          description: p.preview,
          insert: { type: "persona", payload: { key: p.key }, display: p.key } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(persona: ${m.payload.key})`
    },
  }
}
```

- [ ] **Step 4: 注册 + 跑测试通过**

`registry.ts` builtin 加 `makePersonasProvider()`。
Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/personas-provider.test.ts`
Expected: 1 passed。

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/chat/composer/providers/personas.ts packages/ui/src/chat/composer/providers/registry.ts packages/ui/src/chat/composer/__tests__/personas-provider.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): @persona mentions provider"
```

### Task 4.5: Channels provider

**Files:**
- Create: `packages/ui/src/chat/composer/providers/channels.ts`
- Modify: `providers/registry.ts`
- Test: `packages/ui/src/chat/composer/__tests__/channels-provider.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/ui/src/chat/composer/__tests__/channels-provider.test.ts`：
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeChannelsProvider } from "../providers/channels"

vi.mock("@hermes-x/core", () => ({
  listChannels: () => [
    { id: "cli", fallbackLabel: "CLI", labelKey: "channel.cli", isLocal: true },
    { id: "telegram", fallbackLabel: "Telegram", labelKey: "channel.telegram", isLocal: false },
  ],
}))

describe("channels provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns channel mentions", async () => {
    const items = await makeChannelsProvider().search("tele")
    expect(items[0].insert).toEqual({ type: "channel", payload: { id: "telegram" }, display: "Telegram" })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/channels-provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `packages/ui/src/chat/composer/providers/channels.ts`：
```typescript
import { listChannels } from "@hermes-x/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

export function makeChannelsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "channels",
    group: "Channels",
    ownsType: "channel",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      return listChannels()
        .filter((c) => c.fallbackLabel.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
        .slice(0, 15)
        .map((c) => ({
          id: `channels:${c.id}`,
          label: c.fallbackLabel,
          insert: { type: "channel", payload: { id: c.id }, display: c.fallbackLabel } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(channel: ${m.payload.id})`
    },
  }
}
```
> `ChannelDescriptor` 的字段名以 `packages/core/src/channels.ts` 实际为准（`fallbackLabel`/`labelKey`/`id`/`isLocal`）；若 i18n label 可解析，优先用解析后的本地化名做 `display`，否则用 `fallbackLabel`。

- [ ] **Step 4: 注册 + 跑测试通过**

`registry.ts` builtin 加 `makeChannelsProvider()`。
Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/channels-provider.test.ts`
Expected: 1 passed。

- [ ] **Step 5: 全量回归 + 手测多 provider 共存**

Run: `pnpm --filter @hermes-x/ui test`
手测 `@` 菜单分组显示 Skills / Sessions / Personas / Channels（各组若干条）。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/composer/providers/channels.ts packages/ui/src/chat/composer/providers/registry.ts packages/ui/src/chat/composer/__tests__/channels-provider.test.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): @channel mentions provider"
```

---

# Part 5 — 注入 provider（桌面 Files / 扩展 Page-context）

### Task 5.1: Composer/ChatSurface 暴露 mentionProviders 注入口

**Files:**
- Modify: `packages/ui/src/chat/Composer.tsx`、`ChatSurface.tsx`、`packages/ui/src/chat/index.ts`（如需导出类型）
- Create: `packages/ui/src/chat/composer/providers/injectable.ts`
- Test: `packages/ui/src/chat/composer/__tests__/registry-injection.test.ts`

- [ ] **Step 1: 写失败测试（registry 合并注入 provider）**

Create `packages/ui/src/chat/composer/__tests__/registry-injection.test.ts`：
```typescript
import { describe, expect, it } from "vitest"
import { buildProviderRegistry } from "../providers/registry"
import type { TriggerProvider } from "../providers/types"

const files: TriggerProvider = {
  trigger: "@", id: "files", ownsType: "file",
  match: () => true, search: async () => [], onSelect: () => {},
}

describe("registry injection", () => {
  it("includes injected providers for @", () => {
    const reg = buildProviderRegistry([files])
    expect(reg.forTrigger("@").some((p) => p.id === "files")).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `pnpm --filter @hermes-x/ui test -- src/chat/composer/__tests__/registry-injection.test.ts`
Expected: 若 Task 3.6 的 registry 已支持 extra，应直接 PASS；否则补 `extra` 合并逻辑使其通过。

- [ ] **Step 3: 注入接口类型**

Create `packages/ui/src/chat/composer/providers/injectable.ts`：
```typescript
import type { TriggerProvider } from "./types"

/** Host apps build these and pass via Composer/ChatSurface mentionProviders. */
export type InjectableProvider = TriggerProvider

export interface MentionProvidersInput {
  /** Extra @ providers contributed by the host (files / page-context). */
  providers?: InjectableProvider[]
}
```

- [ ] **Step 4: Composer/ChatSurface 透传**

修改 `Composer.tsx`：props 增加 `mentionProviders?: TriggerProvider[]`，透传给 `<RichComposerEditor mentionProviders={mentionProviders} />`，并把它纳入 `allProviders`（发送展开用）。
修改 `ChatSurface.tsx`：props 增加 `mentionProviders?: TriggerProvider[]`（沿用其既有 props 透传风格），在渲染 `<Composer ... mentionProviders={mentionProviders} />` 处传入。
如类型需导出，`packages/ui/src/chat/index.ts` 增加 `export type { TriggerProvider, MentionData } from "./composer/providers/types"`。

- [ ] **Step 5: typecheck + 测试**

Run: `pnpm --filter @hermes-x/ui typecheck && pnpm --filter @hermes-x/ui test`
Expected: 全绿。

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/chat/
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(ui): mentionProviders injection point on Composer/ChatSurface"
```

### Task 5.2: 桌面 Files provider（IPC 列工作区文件）

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/preload/index.d.ts`（或 HermesBridge 类型定义处）
- Create: `apps/desktop/src/renderer/chat/files-provider.ts`
- Modify: 桌面挂载 ChatSurface 处，传 `mentionProviders={[filesProvider]}`
- Test: `apps/desktop/src/renderer/chat/__tests__/files-provider.test.ts`（若 desktop 无 vitest，则改为在 packages/ui 放一个对纯过滤函数的单测）

- [ ] **Step 1: MAIN：files:list 处理器**

修改 `apps/desktop/src/main/ipc.ts`，在 `registerIpcHandlers()` 内加（紧挨 workspace handlers）：
```typescript
import { readdir } from "node:fs/promises"
import { join } from "node:path"

ipcMain.handle(
  "files:list",
  async (_e, args: { sessionId: string; query: string }): Promise<{ path: string; isDir: boolean }[]> => {
    const root = workspaceManager.getForSession(args.sessionId)
    if (!root) return []
    const q = (args.query || "").toLowerCase()
    try {
      const entries = await readdir(root, { withFileTypes: true })
      return entries
        .filter((e) => !e.name.startsWith("."))
        .filter((e) => e.name.toLowerCase().includes(q))
        .slice(0, 30)
        .map((e) => ({ path: join(root, e.name), isDir: e.isDirectory() }))
    } catch {
      return []
    }
  },
)
```
> v1 只列工作区根目录一层（含目录），满足 `@file` 基本补全；递归/子目录展开为后续增强（不阻塞交付）。

- [ ] **Step 2: PRELOAD：桥接**

修改 `apps/desktop/src/preload/index.ts`，在 `api` 对象内加：
```typescript
  files: {
    list: (sessionId: string, query: string): Promise<{ path: string; isDir: boolean }[]> =>
      ipcRenderer.invoke("files:list", { sessionId, query }),
  },
```
并在 `HermesBridge` 类型（`index.d.ts` 或 index.ts 的导出类型）相应加 `files: { list(sessionId: string, query: string): Promise<{ path: string; isDir: boolean }[]> }`。

- [ ] **Step 3: RENDERER：Files provider**

Create `apps/desktop/src/renderer/chat/files-provider.ts`：
```typescript
import type { LexicalEditor } from "lexical"
import {
  insertMentionAtTrigger,
} from "@hermes-x/ui/chat/composer/providers/skills"  // 若无子路径导出，则从 ui 顶层导出 insertMentionAtTrigger
import type { MenuItem, MentionData, TriggerProvider } from "@hermes-x/ui"

export function makeDesktopFilesProvider(getSessionId: () => string): TriggerProvider {
  return {
    trigger: "@",
    id: "files",
    group: "Files",
    ownsType: "file",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const rows = await window.hermes.files.list(getSessionId(), query)
      return rows.map((r) => ({
        id: `files:${r.path}`,
        label: r.path.split("/").pop() || r.path,
        description: r.path,
        insert: { type: "file", payload: { path: r.path }, display: r.path.split("/").pop() || r.path } as MentionData,
      }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return m.payload.path
    },
  }
}
```
> 需要 `insertMentionAtTrigger` 可被 desktop import：在 `packages/ui` 顶层 `index.ts` 导出 `export { insertMentionAtTrigger } from "./chat/composer/providers/skills"`，desktop 改为 `import { insertMentionAtTrigger } from "@hermes-x/ui"`。同时 `TriggerProvider/MenuItem/MentionData` 也从 `@hermes-x/ui` 导出。

- [ ] **Step 4: 挂载注入**

在桌面渲染 ChatSurface 的位置（`FullScreenChatView` 经 ChatSurface，或 `apps/desktop/src/renderer/App.tsx` 传入），构造 `const filesProvider = useMemo(() => makeDesktopFilesProvider(() => activeSessionId), [activeSessionId])` 并以 `mentionProviders={[filesProvider]}` 传入 ChatSurface。`activeSessionId` 用桌面现有的会话 id 获取方式。

- [ ] **Step 5: typecheck + 手测**

Run: `pnpm --filter @hermes-x/desktop typecheck`（若无该 script，跑 `pnpm build:desktop` 的 tsc 阶段）。
手测：桌面绑定一个工作区后，`@` 菜单出现 Files 分组，输入文件名前缀能补全，选中插入 `@<filename>` 芯片；发送时展开成路径。

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/src/main/ipc.ts apps/desktop/src/preload/ apps/desktop/src/renderer/chat/files-provider.ts packages/ui/src/index.ts
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(desktop): @file mentions via files:list IPC provider"
```

### Task 5.3: 扩展 Page-context provider（`@page` / `@tab`）

**Files:**
- Create: `apps/browser-extension/src/lib/chat/page-context-provider.ts`
- Modify: `apps/browser-extension/src/sidepanel/index.tsx`（传 `mentionProviders`）
- Test: 纯过滤/映射函数单测（可放 packages/ui 或扩展若有 vitest）

- [ ] **Step 1: 实现 provider**

Create `apps/browser-extension/src/lib/chat/page-context-provider.ts`：
```typescript
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "@hermes-x/ui"
import type { MenuItem, MentionData, TriggerProvider } from "@hermes-x/ui"
import { chromePageContext } from "./chrome-capabilities"

export function makePageContextProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "pageContext",
    group: "Page",
    ownsType: "page",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const tab = await chromePageContext.getActiveBrowserTab()
      const items: MenuItem[] = []
      if (tab) {
        const title = tab.title || tab.url || "current tab"
        items.push({
          id: "page:current",
          label: "Current page",
          description: title,
          insert: { type: "page", payload: { tabId: String(tab.id ?? ""), title }, display: title } as MentionData,
        })
      }
      const q = query.toLowerCase()
      return items.filter((i) => i.label.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      // Expand to the current page context block at send time.
      return `[page: ${m.payload.title}]`
    },
  }
}
```
> 进阶：`serialize` 可改为同步拿不到上下文，故页面正文展开仍由 ChatSurface 既有的 page-context 注入链路负责；这里的芯片主要表达"引用了当前页"，正文由现有 `chromeCapabilities.pageContext` 机制附带。保持 v1 简单：芯片 = 标记，正文上下文沿用现有逻辑。

- [ ] **Step 2: 注入到 sidepanel**

修改 `apps/browser-extension/src/sidepanel/index.tsx`：`import { makePageContextProvider } from "../lib/chat/page-context-provider"`，构造 `const pageProvider = useMemo(() => makePageContextProvider(), [])`，给 `<ChatSurface ... mentionProviders={[pageProvider]} />`。

- [ ] **Step 3: typecheck + 手测**

Run: `pnpm --filter @hermes-x/browser-extension build`（或其 typecheck）。
手测：扩展侧栏 `@` 菜单出现 Page 分组，选「Current page」插入芯片；扩展端 `@` 不出现 Files 分组（优雅降级）。

- [ ] **Step 4: Commit**
```bash
git add apps/browser-extension/src/lib/chat/page-context-provider.ts apps/browser-extension/src/sidepanel/index.tsx
git -c user.name="iHeyTang" -c user.email="dehui1012@gmail.com" commit -m "feat(extension): @page/@tab page-context mentions provider"
```

---

## 收尾验证（全部 Task 完成后）

- [ ] **全量测试**：`pnpm --filter @hermes-x/core test && pnpm --filter @hermes-x/ui test`，以及 `cd ../hermes-x-plugin-http-backplane && python -m pytest -q`。全绿。
- [ ] **typecheck**：`pnpm --filter @hermes-x/core typecheck && pnpm --filter @hermes-x/ui typecheck && pnpm --filter @hermes-x/desktop typecheck`（或各自 build 的 tsc 阶段）。
- [ ] **桌面手测全链路**：`/` 命令（含 subcommand 菜单、ui-action 如 `/config` 开设置、send 类整行发送）、`@` 五类（Skills/Sessions/Personas/Channels/Files）插芯片+发送展开、IME/Enter/Shift+Enter/附件/快捷动作/麦克风/占位 无回归。
- [ ] **扩展手测**：`@` 四类内置 + Page 分组；无 Files 分组。
- [ ] **回归确认**：5 个消费界面（ChatView / ChatSurface / Quick-Ask / 扩展侧栏 / 桌面主窗）输入与发送均正常。
