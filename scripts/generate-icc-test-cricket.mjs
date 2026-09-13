import { mkdir, writeFile } from "node:fs/promises";
import { buildIccTestCricketCalendar, getCricketDataUsage } from "../src/icc-test-cricket.mjs";

await mkdir("public", { recursive: true });
await writeFile(
  "public/icc-test-cricket.ics",
  await buildIccTestCricketCalendar(process.env.CRICKETDATA_API_KEY, {
    usagePath: "state/cricketdata-usage.json",
  }),
  "utf8"
);
const usage = getCricketDataUsage();
console.log(`CricketData API calls this run: ${usage.runCalls}; aggregate today: ${usage.total}/${usage.limit}.`);
