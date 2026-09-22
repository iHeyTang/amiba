import type { PluginStartupState } from "../shared/plugin-startup";

/** Static startup chrome; does not import DSH, React, or user plugin modules. */
export async function preparePluginStartup(): Promise<() => void> {
  const screen = document.querySelector<HTMLElement>(".amiba-startup-screen");
  if (!screen) return () => {};
  const chinese = navigator.language.startsWith("zh");
  const controls = document.createElement("div");
  controls.className = "amiba-plugin-startup";
  controls.hidden = true;
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = chinese ? "继续" : "Continue";
  const safe = document.createElement("button");
  safe.type = "button";
  safe.textContent = chinese ? "安全启动" : "Safe start";
  safe.title = chinese ? "本次不加载用户插件" : "Skip user plugins for this launch";
  actions.append(next, safe);
  controls.append(status, actions);
  screen.append(controls);
  let current: PluginStartupState | undefined;
  const render = () => {
    if (!current) return;
    controls.hidden = current.phase === "ready" && !current.reason;
    next.hidden = current.phase !== "prompt";
    safe.hidden = current.phase !== "prompt";
    actions.hidden = current.phase !== "prompt";
    if (current.phase === "prompt") {
      const seconds = Math.max(1, Math.ceil(((current.deadline ?? Date.now() + 3000) - Date.now()) / 1000));
      status.textContent = chinese ? `即将加载用户插件 · ${seconds} 秒` : `Loading your plugins in ${seconds}s`;
    } else if (current.phase === "loading") {
      status.textContent = chinese ? "正在加载用户插件…" : "Loading your plugins…";
    } else if (current.phase === "safe") {
      status.textContent = chinese ? "安全启动 · 已跳过用户插件" : "Safe start · user plugins skipped";
    }
  };
  const choose = (choice: "continue" | "safe") => {
    void window.amiba.pluginStartup.choose(choice).catch(error => {
      status.textContent = String(error);
    });
  };
  next.onclick = () => choose("continue");
  safe.onclick = () => choose("safe");
  const off = window.amiba.pluginStartup.onState(state => { current = state; render(); });
  current = await window.amiba.pluginStartup.present();
  render();
  const timer = window.setInterval(render, 200);
  return () => { off(); window.clearInterval(timer); controls.remove(); };
}
