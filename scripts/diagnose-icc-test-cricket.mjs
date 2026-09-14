import { diagnoseIccTestCricket, getCricketDataUsage } from "../src/icc-test-cricket.mjs";

try {
  await diagnoseIccTestCricket(process.env.CRICKETDATA_API_KEY);
} finally {
  const usage = getCricketDataUsage();
  console.log(`CricketData API calls this diagnostic run: ${usage.runCalls}/${usage.limit}.`);
}
