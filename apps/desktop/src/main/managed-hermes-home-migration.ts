import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MESSAGING_ENV_MIGRATION_MARKER = ".amiba-messaging-env-migrated-v2";

const MESSAGING_ENV_PREFIXES = [
  "BLUEBUBBLES_",
  "BUZZ_",
  "DINGTALK_",
  "DISCORD_",
  "EMAIL_",
  "FEISHU_",
  "GOOGLE_CHAT_",
  "HASS_",
  "IRC_",
  "LINE_",
  "MATRIX_",
  "MATTERMOST_",
  "NTFY_",
  "PHOTON_",
  "QQBOT_",
  "QQ_",
  "RAFT_",
  "SIGNAL_",
  "SIMPLEX_",
  "SLACK_",
  "SMS_",
  "TEAMS_",
  "TELEGRAM_",
  "TWILIO_",
  "WECOM_",
  "WEIXIN_",
  "WHATSAPP_",
  "YUANBAO_",
] as const;

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

interface DotenvAssignment {
  key: string;
  rawValue: string;
  populated: boolean;
}

export interface MessagingEnvironmentMigrationResult {
  migratedKeys: string[];
  skipped: boolean;
}

const migrationsInFlight = new Map<
  string,
  Promise<MessagingEnvironmentMigrationResult>
>();

function assignmentFromLine(line: string): DotenvAssignment | null {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) return null;
  const separator = stripped.indexOf("=");
  if (separator < 1) return null;
  const key = stripped.slice(0, separator).trim();
  if (!ENV_KEY_RE.test(key)) return null;
  const rawValue = stripped.slice(separator + 1).trim();
  const unquoted =
    rawValue.length >= 2 &&
    rawValue[0] === rawValue[rawValue.length - 1] &&
    (rawValue[0] === '"' || rawValue[0] === "'")
      ? rawValue.slice(1, -1)
      : rawValue;
  return { key, rawValue, populated: unquoted.trim().length > 0 };
}

function assignments(text: string): Map<string, DotenvAssignment> {
  const result = new Map<string, DotenvAssignment>();
  for (const line of text.split(/\r?\n/)) {
    const assignment = assignmentFromLine(line);
    if (assignment) result.set(assignment.key, assignment);
  }
  return result;
}

function isMessagingKey(key: string): boolean {
  return MESSAGING_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function deduplicateMessagingAssignments(text: string): string {
  const lines = text.split(/\r?\n/);
  const lastIndexByKey = new Map<string, number>();
  lines.forEach((line, index) => {
    const assignment = assignmentFromLine(line);
    if (assignment && isMessagingKey(assignment.key)) {
      lastIndexByKey.set(assignment.key, index);
    }
  });
  const deduplicated = lines.filter((line, index) => {
    const assignment = assignmentFromLine(line);
    return (
      !assignment ||
      !isMessagingKey(assignment.key) ||
      lastIndexByKey.get(assignment.key) === index
    );
  });
  return deduplicated.join("\n");
}

async function readTextIfPresent(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Copy previously configured messaging credentials from the conventional
 * ~/.hermes home into Amiba's private managed home once.
 *
 * Existing populated managed values always win. Provider/model credentials
 * and generated API-server keys are deliberately out of scope. The marker is
 * durable so clearing a channel later does not import the legacy value again.
 */
async function performMessagingEnvironmentMigration(
  legacyHome: string,
  managedHome: string,
): Promise<MessagingEnvironmentMigrationResult> {
  const marker = path.join(managedHome, MESSAGING_ENV_MIGRATION_MARKER);
  try {
    await fs.access(marker);
    return { migratedKeys: [], skipped: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const managedEnvPath = path.join(managedHome, ".env");
  const legacyEnvPath = path.join(legacyHome, ".env");
  const [originalManagedText, legacyText] = await Promise.all([
    readTextIfPresent(managedEnvPath),
    readTextIfPresent(legacyEnvPath),
  ]);
  const managedText = deduplicateMessagingAssignments(originalManagedText);
  const managed = assignments(managedText);
  const legacy = assignments(legacyText);
  const additions = [...legacy.values()]
    .filter(
      ({ key, populated }) =>
        isMessagingKey(key) && populated && !managed.get(key)?.populated,
    )
    .sort((left, right) => left.key.localeCompare(right.key));

  if (additions.length || managedText !== originalManagedText) {
    const prefix = managedText && !managedText.endsWith("\n") ? "\n" : "";
    const body = additions
      .map(({ key, rawValue }) => `${key}=${rawValue}`)
      .join("\n");
    const nextText = additions.length
      ? `${managedText}${prefix}${body}\n`
      : managedText;
    const temporaryPath = `${managedEnvPath}.tmp-${randomUUID()}`;
    await fs.writeFile(temporaryPath, nextText, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, managedEnvPath);
    if (process.platform !== "win32") {
      await fs.chmod(managedEnvPath, 0o600).catch(() => {});
    }
  }

  await fs
    .writeFile(marker, "migrated\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    .catch((error: NodeJS.ErrnoException) => {
      // Two renderer requests may race through ensureBackend during startup.
      // Both compute the same additions; the second marker creation is safe.
      if (error.code !== "EEXIST") throw error;
    });
  return {
    migratedKeys: additions.map(({ key }) => key),
    skipped: false,
  };
}

/**
 * Copy previously configured messaging credentials from the conventional
 * ~/.hermes home into Amiba's private managed home once.
 *
 * Calls are coalesced because several Desktop surfaces can request the
 * backplane during startup. V2 also repairs duplicate messaging assignments
 * created by the former append-only migration while keeping the last value,
 * matching dotenv's normal precedence.
 */
export async function migrateLegacyMessagingEnvironment(
  legacyHome: string,
  managedHome: string,
): Promise<MessagingEnvironmentMigrationResult> {
  const migrationKey = `${path.resolve(legacyHome)}\0${path.resolve(managedHome)}`;
  const running = migrationsInFlight.get(migrationKey);
  if (running) return running;
  const migration = performMessagingEnvironmentMigration(
    legacyHome,
    managedHome,
  ).finally(() => migrationsInFlight.delete(migrationKey));
  migrationsInFlight.set(migrationKey, migration);
  return migration;
}
