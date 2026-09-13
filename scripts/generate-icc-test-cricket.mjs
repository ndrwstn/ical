import { mkdir, writeFile } from "node:fs/promises";
import { buildIccTestCricketCalendar } from "../src/icc-test-cricket.mjs";

await mkdir("public", { recursive: true });
await writeFile(
  "public/icc-test-cricket.ics",
  await buildIccTestCricketCalendar(process.env.CRICKETDATA_API_KEY),
  "utf8"
);
