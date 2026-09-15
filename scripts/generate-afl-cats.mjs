import { mkdir, writeFile } from "node:fs/promises";
import { buildAflCatsCalendar } from "../src/afl-cats.mjs";

await mkdir("public", { recursive: true });
await writeFile("public/afl-cats.ics", await buildAflCatsCalendar(), "utf8");
