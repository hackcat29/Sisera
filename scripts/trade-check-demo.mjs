import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApi } from "../apps/api/src/app.ts";
import { readConfig } from "../apps/api/src/config.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${root}/.env`)) process.loadEnvFile(`${root}/.env`);
const config = readConfig({
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: undefined,
  SISERA_ALLOW_DEV_AUTH: "true",
  SISERA_SCHEDULER_ENABLED: "false",
  SISERA_BUYBOT_ENABLED: "false",
  SISERA_LIVE_SOLANA_ENABLED: "false",
  SISERA_LIVE_PREDICTIONS_ENABLED: "false",
  SISERA_LIVE_AGENTS_ENABLED: "false",
  SISERA_LIVE_LAUNCHES_ENABLED: "false",
  SISERA_DELEGATED_SIGNING_ENABLED: "false",
  LOG_LEVEL: "warn",
});
const app = await buildApi(config);
await app.listen({ port: 4000, host: "127.0.0.1" });
const web = spawn(
  "pnpm",
  ["exec", "next", "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", "3000"],
  {
    cwd: `${root}/apps/web`,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      SISERA_API_URL: "http://127.0.0.1:4000",
      SISERA_LOCAL_OPERATOR_MODE: "true",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
    },
  },
);
console.log(
  "Trade Check demo: http://127.0.0.1:3000/trade-check (loopback only, no trading or background jobs)",
);
async function stop() {
  web.kill("SIGTERM");
  await app.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", async (code) => {
  await app.close();
  process.exit(code ?? 0);
});
