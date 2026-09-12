import { buildDevelopmentProject } from "@amiba/app-runtime/dsh-runtime";
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
try {
  await buildDevelopmentProject(process.argv[2], { signal: controller.signal });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
