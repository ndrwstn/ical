import { mkdir, writeFile } from "node:fs/promises";
import { buildIccTestCalendar } from "../src/icc-test.mjs";

await mkdir("public", { recursive: true });
await writeFile("public/icc-test.ics", await buildIccTestCalendar(process.env.CRICKETDATA_API_KEY), "utf8");
