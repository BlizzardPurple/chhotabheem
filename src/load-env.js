import { existsSync } from "node:fs";
// Node's parser preserves inherited environment values and supports quoted values.
if (existsSync(".env")) process.loadEnvFile(".env");
