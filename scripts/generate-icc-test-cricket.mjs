import { mkdir, writeFile } from "node:fs/promises";
import { buildIccTestCricketCalendar, getCricketDataUsage } from "../src/icc-test-cricket.mjs";

await mkdir("public", { recursive: true });
try {
  await writeFile(
    "public/icc-test-cricket.ics",
    await buildIccTestCricketCalendar(process.env.CRICKETDATA_API_KEY),
    "utf8"
  );
} finally {
  const usage = getCricketDataUsage();
  console.log(`CricketData API calls this run: ${usage.runCalls}/${usage.limit}.`);
}
