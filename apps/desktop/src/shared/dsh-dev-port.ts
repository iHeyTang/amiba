export function resolveDshListenPort(
  packaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.AMIBA_DSH_DEV_PORT?.trim();
  if (packaged || !configured) return "0";
  if (!/^\d+$/u.test(configured)) {
    throw new Error("AMIBA_DSH_DEV_PORT must be an integer TCP port.");
  }
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("AMIBA_DSH_DEV_PORT must be between 1024 and 65535.");
  }
  return String(port);
}
