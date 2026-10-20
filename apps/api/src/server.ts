import { buildApi } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const app = await buildApi(config);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

// A background fetch that fails without a handler must not take the whole API down with it: Node
// exits on an unhandled rejection by default, which turned provider timeouts into outages.
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandled promise rejection");
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
