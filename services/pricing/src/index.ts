import { loadDotEnv } from "@orionis/config";
loadDotEnv();

const { buildServer } = await import("./server.js");

const port = Number(process.env.PRICING_PORT ?? 4100);
const app = buildServer();

app
  .listen({ port, host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
