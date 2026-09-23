import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { BackgroundStore } from "./store.js";
import type { BackgroundConfig } from "./model.js";
class BackgroundRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly store: BackgroundStore,
  ) {
    super(ctx, "amibaBackground");
  }
  @Remote get() {
    return this.store.get();
  }
  @Remote configure(config: BackgroundConfig, revision: number) {
    return this.store.configure(config, revision);
  }
  @Remote beginUpload(bytes: number) {
    return this.store.beginUpload(bytes);
  }
  @Remote upload(id: string, offset: number, data: string) {
    return this.store.upload(id, offset, data);
  }
  @Remote finishUpload(id: string) {
    return this.store.finishUpload(id);
  }
  @Remote asset(id: string, offset: number) {
    return this.store.asset(id, offset);
  }
}
const output = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { json: { type: "string" } },
    required: ["json"],
  },
  render: (_args: unknown, value: { json: string }) => [
    { type: "text" as const, text: value.json },
  ],
};
interface BackgroundTool {
  name: string;
  description: string;
  parameters: object;
  output: typeof output;
  isConcurrencySafe?: () => boolean;
  execute(args: Record<string, unknown>): Promise<{ json: string }>;
}
export function installBackground(
  ctx: Context,
  root = dshHomePath("amiba", "backgrounds"),
) {
  const store = new BackgroundStore(root);
  new BackgroundRemote(ctx, store);
  ctx.effect(() => () => store.dispose());
  ctx.inject(["tools"], (child) => {
    // Keep the host ToolRuntime's Context.sessions declaration out of this
    // package's client compilation (the client has its own sessions service).
    const tools = child.reflect.get("tools") as {
      register(definition: BackgroundTool): () => void;
    };
    const register = (definition: BackgroundTool) =>
      child.effect(() => tools.register(definition), definition.name);
    register({
      name: "background_get",
      description:
        "Read Amiba's shared application background settings and revision before changing them. Settings affect all connected windows, persist across restart, and are also editable under Appearance.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output,
      isConcurrencySafe: () => true,
      execute: async () => ({ json: JSON.stringify(await store.get()) }),
    });
    register({
      name: "background_import",
      description:
        "Import an explicit local PNG/JPEG/WebP image or MP4/WebM video (up to 64 MiB) into durable Amiba background storage. Returns id; does not activate it. For an image-to-video background request, first use media_describe and media_generate with the selected model's image-input contract; wait for a saved artifact, then import its local path. Never treat a submitted generation job as a completed video. You can import the source image as posterId for reduced-motion and paused playback.",
      parameters: {
        type: "object",
        properties: { filePath: { type: "string" } },
        required: ["filePath"],
        additionalProperties: false,
      },
      output,
      execute: async (args) => ({
        json: JSON.stringify(await store.importFile(String(args.filePath))),
      }),
    });
    register({
      name: "background_configure",
      description:
        "Apply or adjust the Amiba application background when requested by the user. Pass the complete configJson object from background_get, editing fields as needed, and its revision. Fields: enabled boolean, assetId imported id or null, posterId imported image id or null, motion play|pause, fit cover (legacy contain is normalized to cover), dim 0..0.65, blur 0..20 px, glass balanced (one shared glass material). For a generated video: import completed video and optional original-image poster, enable it, and set motion play. Disable with enabled false. Materials preserve reading contrast; reduced-motion preference and hidden windows pause video. Refresh on revision conflict; do not silently overwrite another change.",
      parameters: {
        type: "object",
        properties: {
          configJson: { type: "string" },
          revision: { type: "integer" },
        },
        required: ["configJson", "revision"],
        additionalProperties: false,
      },
      output,
      execute: async (args) => ({
        json: JSON.stringify(
          await store.configure(
            JSON.parse(String(args.configJson)),
            Number(args.revision),
          ),
        ),
      }),
    });
  });
}
