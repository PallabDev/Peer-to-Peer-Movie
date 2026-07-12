import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.js",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./sqlite/db.sqlite"
  }
});
