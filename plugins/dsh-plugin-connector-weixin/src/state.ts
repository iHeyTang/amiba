import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export interface WeixinState {
  cursor: string;
  context: string;
  seen: string[];
  sent: string[];
  quotes: Record<string, { text: string; at: number }>;
}
const empty = (): WeixinState => ({
  cursor: "",
  context: "",
  seen: [],
  sent: [],
  quotes: {},
});
export class StateStore {
  readonly directory: string;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(root: string, identity: string) {
    this.directory = path.join(
      root,
      createHash("sha256").update(identity).digest("hex"),
    );
  }
  async read(): Promise<WeixinState> {
    try {
      return {
        ...empty(),
        ...JSON.parse(
          await readFile(path.join(this.directory, "state.json"), "utf8"),
        ),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw e;
    }
  }
  mutate(fn: (state: WeixinState) => void): Promise<void> {
    const operation = this.chain.then(async () => {
      const state = await this.read();
      fn(state);
      state.seen = state.seen.slice(-2000);
      state.sent = state.sent.slice(-2000);
      state.quotes = Object.fromEntries(
        Object.entries(state.quotes)
          .filter(([, item]) => item.at > Date.now() - 30 * 86400_000)
          .slice(-2000)
          .map(([id, item]) => [
            id,
            { ...item, text: item.text.slice(0, 20_000) },
          ]),
      );
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, path.join(this.directory, "state.json"));
    });
    this.chain = operation.catch(() => {});
    return operation;
  }
}
