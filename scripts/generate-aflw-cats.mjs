import { mkdir, writeFile } from "node:fs/promises";
import { buildAflwCatsCalendar } from "../src/aflw-cats.mjs";

await mkdir("public", { recursive: true });
await writeFile("public/aflw-cats.ics", await buildAflwCatsCalendar(), "utf8");
