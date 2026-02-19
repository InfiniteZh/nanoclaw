import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { api } from "./routes.js";

const app = new Hono();

app.use("*", cors());
app.route("/", api);

// In production, serve static files
if (process.env.NODE_ENV === "production") {
  app.use("*", serveStatic({ root: "./dist/client" }));
  // SPA fallback
  app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));
}

const port = parseInt(process.env.PORT || "3401");
console.log(`[viewer] Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
