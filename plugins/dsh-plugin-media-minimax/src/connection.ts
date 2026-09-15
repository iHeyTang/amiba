import type {} from "@deepseek-ai/dsh-settings";
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import type {} from "@deepseek-ai/dsh-llm";
import { MediaError } from "@amiba/dsh-plugin-media/contracts";
/** Public DSH directory + settings + credential seam. No adapter state or grant payload access. */
export async function minimaxConnection(ctx: Context) {
  const entry = ctx.llm
    .listConfigurableProviders()
    .find((p) => p.provider === "minimax-cn");
  if (
    !entry ||
    entry.settingsNs !== "llm-pi-ai" ||
    !ctx.llm.listProviders().some((p) => p.id === entry.provider)
  )
    throw new MediaError(
      "UNAVAILABLE",
      "Configure the official minimax-cn provider first",
    );
  let profile: any = ctx.settings.get(entry.settingsNs);
  for (const key of entry.settingsPath) profile = profile?.[key];
  if (!profile || typeof profile.apiKeyEnv !== "string" || !profile.apiKeyEnv)
    throw new MediaError(
      "UNAVAILABLE",
      "minimax-cn media requires an explicit API Key reference; login/OAuth credentials are not reused",
    );
  const base = new URL(profile.baseURL ?? "https://api.minimax.cn");
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.port ||
    !["api.minimax.cn", "api.minimaxi.com"].includes(base.hostname)
  )
    throw new MediaError(
      "UNAVAILABLE",
      "This media extension supports MiniMax China official API endpoints only",
    );
  // Capture connection settings before awaiting credentials, keeping one request on one configuration.
  const headers = { ...profile.headers };
  for (const key of Object.keys(headers))
    if (/^(authorization|cookie|host|x-api-key|content-length)$/i.test(key))
      throw new MediaError(
        "UNAVAILABLE",
        `Unsupported connection header: ${key}`,
      );
  const credential = await ctx.credentials.resolve(
    credentialRef(profile.apiKeyEnv),
  );
  if (!credential?.value?.trim())
    throw new MediaError("UNAVAILABLE", "minimax-cn API Key is not configured");
  return { baseURL: base.origin, apiKey: credential.value.trim(), headers };
}
