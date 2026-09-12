import { mkdir, writeFile } from "node:fs/promises";
import { buildCalendar } from "../src/ufc.mjs";

await mkdir("public", { recursive: true });
await writeFile("public/ufc.ics", await buildCalendar(), "utf8");
