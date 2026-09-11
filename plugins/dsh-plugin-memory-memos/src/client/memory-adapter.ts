import {
  memorySessionSchema,
  type MemoryCorrectionRequest,
  type MemoryUpdate,
  type MemoryEntry,
  type MemoryOverview,
  type MemoryPage,
  type MemoryQuery,
  type MemoryDetailQuery,
  type MemoryDetail,
} from "../dashboard.js";
import type { MemoryAdapter } from "./MemoryPage.js";

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } };
type MemoryRemote = {
  beginCorrection(input: MemoryCorrectionRequest): Promise<Result<string>>;
  update(input: MemoryUpdate): Promise<Result<MemoryEntry>>;
  login(password: string): Promise<Result<string>>;
  overview(session?: string): Promise<Result<MemoryOverview>>;
  detail(query: MemoryDetailQuery): Promise<Result<MemoryDetail>>;
  browse(query: MemoryQuery): Promise<Result<MemoryPage>>;
};
const sessionKey = "amiba.memory.session.v1";

export function createMemoryAdapter(
  remote: MemoryRemote,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): MemoryAdapter {
  let session: string | undefined;
  try {
    const saved = memorySessionSchema.safeParse(storage?.getItem(sessionKey));
    if (saved.success) session = saved.data;
  } catch {
    /* Storage may be unavailable; keep the current session in memory. */
  }

  function unwrap<T>(result: Result<T>, requestedSession?: string): T {
    if (result.ok) return result.value;
    if (
      result.error.message.includes("MEMOS_AUTH_REQUIRED") &&
      session === requestedSession
    ) {
      session = undefined;
      try {
        storage?.removeItem(sessionKey);
      } catch {
        /* In-memory invalidation still applies. */
      }
    }
    throw new Error(result.error.message);
  }
  return {
    async beginCorrection(input) {
      const current = session;
      return unwrap(
        await remote.beginCorrection({ ...input, session: current }),
        current,
      );
    },
    async update(input) {
      const current = session;
      return unwrap(
        await remote.update({ ...input, session: current }),
        current,
      );
    },
    async login(password) {
      session = memorySessionSchema.parse(
        unwrap(await remote.login(password), session),
      );
      try {
        storage?.setItem(sessionKey, session);
      } catch {
        /* Keep the valid session in memory. */
      }
    },
    async overview() {
      const current = session;
      return unwrap(await remote.overview(current), current);
    },
    async detail(input) {
      const current = session;
      return unwrap(
        await remote.detail({ ...input, session: current }),
        current,
      );
    },
    async browse(input) {
      const current = session;
      return unwrap(
        await remote.browse({ ...input, session: current }),
        current,
      );
    },
  };
}
