import { mkdir, writeFile } from "node:fs/promises";
import { buildIccTestCricketCalendar } from "../src/icc-test-cricket.mjs";

await mkdir("public", { recursive: true });
const { calendar, fixtures } = await buildIccTestCricketCalendar();
await writeFile("public/icc-test-cricket.ics", calendar, "utf8");
console.log(`ICC Test Cricket calendar: ${fixtures.length} Tests and ${calendar.match(/BEGIN:VEVENT/g)?.length || 0} day-block events.`);
