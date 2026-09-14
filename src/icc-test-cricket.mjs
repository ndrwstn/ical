const API_ROOT = "https://api.cricapi.com/v1";
const PILOT_TEAMS = new Set(["Australia", "England", "India", "New Zealand", "South Africa"]);
const INTERNATIONAL_TEAMS = new Set([
  "Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland",
  "New Zealand", "Pakistan", "South Africa", "Sri Lanka", "West Indies", "Zimbabwe"
]);

function escapeIcs(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function utc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function cleanTeam(value = "") {
  return String(value).replace(/\s+(Women|W)$/i, "").trim();
}

function matchRecord(record) {
  return record?.matchInfo || record?.match || record || {};
}

function seriesNameFor(match) {
  const series = match.series;
  return String(
    series?.name || match.seriesName || (typeof series === "string" ? series : "") || ""
  ).trim();
}

function isWomenMatch(match, teams) {
  return /women|\bW\b/i.test(`${match.name || ""} ${seriesNameFor(match)}`) ||
    teams.some((team) => /\s+(Women|W)$/i.test(team));
}

function teamsFor(record) {
  const match = matchRecord(record);
  if (Array.isArray(match.teams) && match.teams.length === 2) return match.teams;
  if (Array.isArray(match.teamInfo) && match.teamInfo.length === 2) {
    return match.teamInfo.map((team) => team.name).filter(Boolean);
  }
  return [];
}

function startFor(record) {
  const match = matchRecord(record);
  const raw = match.dateTimeGMT || match.dateTime || match.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function testLabel(match) {
  const text = String(match.name || "");
  const numbered = text.match(/\b(\d+(?:st|nd|rd|th)\s+Test|Only\s+Test)\b/i)?.[1];
  return numbered || "Test";
}

function eventUrl(match) {
  return match.url || match.matchUrl || "https://cricketdata.org/";
}

function isEnded(match) {
  return match.matchEnded === true || String(match.matchEnded).toLowerCase() === "true";
}

function includeMatch(record) {
  const match = matchRecord(record);
  const format = String(match.matchType || match.format || "").toLowerCase();
  const looksLikeTest = format === "test" || (!format && /\btest\b/i.test(String(match.name || "")));
  if (!looksLikeTest || isEnded(match)) return false;
  const teams = teamsFor(match);
  if (teams.length !== 2) return false;
  const normalized = teams.map(cleanTeam);
  return normalized.every((team) => INTERNATIONAL_TEAMS.has(team)) &&
    normalized.some((team) => PILOT_TEAMS.has(team));
}

const API_CALL_LIMIT = 90;
let runCallLimit = API_CALL_LIMIT;
let runCalls = 0;

function startRun(maxCalls = API_CALL_LIMIT) {
  runCalls = 0;
  runCallLimit = Math.min(API_CALL_LIMIT, Math.max(1, Number(maxCalls) || API_CALL_LIMIT));
}

async function reserveApiCall() {
  if (runCalls >= runCallLimit) {
    const error = new Error(`CricketData call limit reached for this run (${runCallLimit} calls).`);
    error.code = "API_CALL_LIMIT";
    throw error;
  }
  runCalls += 1;
}

export function getCricketDataUsage() {
  return { runCalls, limit: runCallLimit };
}

async function apiFetch(path, apiKey, params = {}) {
  await reserveApiCall();
  const url = new URL(`${API_ROOT}/${path}`);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`CricketData ${path} returned ${response.status}`);
  const body = await response.json();
  if (body.status === "failure") throw new Error(`CricketData ${path}: ${body.reason || "request failed"}`);
  return body;
}

async function fetchPages(path, apiKey, maxPages) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await apiFetch(path, apiKey, { offset });
    const data = Array.isArray(body.data) ? body.data : [];
    all.push(...data);
    const next = body.info?.nextOffset;
    if (!data.length || next === undefined || next === null || Number(next) === offset) break;
    offset = Number(next);
  }
  return all;
}

function futurePilotSeries(series) {
  const name = String(series?.name || series?.seriesName || "");
  if (!name || ![...PILOT_TEAMS].some((team) => new RegExp(`\\b${team.replace(/ /g, "\\s+")}\\b`, "i").test(name))) return false;
  const end = new Date(series?.endDate || series?.enddate || series?.end);
  return Number.isNaN(end.getTime()) || end.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

function matchesFromSeriesInfo(body) {
  const data = body?.data || {};
  const candidates = [
    data.matchList, data.matches, data.matchInfo,
    Array.isArray(data) ? data : null,
  ];
  return candidates.find(Array.isArray) || [];
}

async function fetchSeriesFixtures(apiKey) {
  try {
    const series = await fetchPages("series", apiKey, 12);
    const candidates = series.filter(futurePilotSeries).slice(0, 8);
    const details = await Promise.all(candidates.map(async (item) => {
      const id = item?.id || item?.seriesId;
      if (!id) return [];
      try {
        return matchesFromSeriesInfo(await apiFetch("series_info", apiKey, { id }));
      } catch (error) {
        if (error.code === "API_CALL_LIMIT") throw error;
        console.warn(`Could not read series ${id}: ${error.message}`);
        return [];
      }
    }));
    console.log(`CricketData series discovery: ${series.length} series scanned, ${candidates.length} relevant series checked.`);
    return details.flat();
  } catch (error) {
    if (error.code === "API_CALL_LIMIT") throw error;
    console.warn(`CricketData series discovery unavailable: ${error.message}`);
    return [];
  }
}

function buildCalendar(matches) {
  const stamp = utc(new Date());
  const entries = [];
  for (const record of matches) {
    const match = matchRecord(record);
    const teams = teamsFor(match);
    const start = startFor(match);
    if (!start || teams.length !== 2) continue;
    const days = isWomenMatch(match, teams) ? 4 : 5;
    const test = testLabel(match);
    const series = seriesNameFor(match);
    for (let day = 1; day <= days; day += 1) {
      const dayStart = new Date(start.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 7 * 60 * 60 * 1000);
      const title = `${teams[0]} v. ${teams[1]} — ${test} — Day ${day}`;
      const description = [
        series && `Series: ${series}`,
        "Scheduled day estimate; actual play may change due to weather, light, or match conditions.",
        "Times are based on the fixture's scheduled match start.",
        `Source: ${eventUrl(match)}`,
      ].filter(Boolean).join("\n");
      entries.push([
        "BEGIN:VEVENT",
        `UID:${encodeURIComponent(`${match.id || title}-day-${day}`)}@ical.ndrwstn.github.io`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(dayStart)}`,
        `DTEND:${utc(dayEnd)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `LOCATION:${escapeIcs(match.venue || "TBD")}`,
        `DESCRIPTION:${escapeIcs(description)}`,
        `URL:${eventUrl(match)}`,
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:PT0M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcs(title)}`,
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"));
    }
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ndrwstn//ICC Test Cricket//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ICC Test Cricket",
    ...entries,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function seriesMetadata(series) {
  return {
    id: series?.id || series?.seriesId || null,
    name: String(series?.name || series?.seriesName || ""),
    startDate: series?.startDate || series?.startdate || series?.start || null,
    endDate: series?.endDate || series?.enddate || series?.end || null,
    test: series?.test ?? series?.tests ?? null,
    fields: Object.keys(series || {}).sort(),
  };
}

function hasTeamName(name, team) {
  const alternatives = {
    Australia: ["australia", "aus"],
    England: ["england", "eng"],
    "New Zealand": ["new zealand", "nz"],
    "South Africa": ["south africa", "sa"],
  };
  const text = name.toLowerCase();
  return (alternatives[team] || [team.toLowerCase()]).some((value) =>
    new RegExp(`(^|[^a-z])${value.replace(/ /g, "\\s+")}([^a-z]|$)`, "i").test(text)
  );
}

export async function diagnoseIccTestCricket(apiKey) {
  if (!apiKey) throw new Error("CRICKETDATA_API_KEY is not configured.");
  startRun(10);
  const series = await fetchPages("series", apiKey, 10);
  const metadata = series.map(seriesMetadata);
  const pilotSeries = metadata.filter((item) =>
    [...PILOT_TEAMS].some((team) => hasTeamName(item.name, team))
  );
  const expected = [
    { fixture: "South Africa v Australia Tests 2026", teams: ["South Africa", "Australia"] },
    { fixture: "Australia v New Zealand Tests 2026-27", teams: ["Australia", "New Zealand"] },
    { fixture: "England v Australia Ashes 2027", teams: ["England", "Australia"] },
  ].map((target) => ({
    ...target,
    found: pilotSeries.some((item) => target.teams.every((team) => hasTeamName(item.name, team))),
  }));
  const output = {
    callsMade: getCricketDataUsage().runCalls,
    seriesRecordsRead: series.length,
    seriesFieldsSeen: [...new Set(metadata.flatMap((item) => item.fields))].sort(),
    pilotSeries: pilotSeries.slice(0, 30),
    expected,
  };
  console.log("ICC Test Cricket diagnostic:");
  console.log(JSON.stringify(output, null, 2));
  if (expected.every((item) => !item.found)) {
    throw new Error("None of the known future pilot Test series appeared in the inspected CricketData series pages.");
  }
  return output;
}

export async function buildIccTestCricketCalendar(apiKey) {
  startRun();
  if (!apiKey) throw new Error("CRICKETDATA_API_KEY is not configured.");
  const [nearTerm, seriesFixtures] = await Promise.all([
    fetchPages("matches", apiKey, 4),
    fetchSeriesFixtures(apiKey),
  ]);
  const selected = [...new Map(
    [...nearTerm, ...seriesFixtures]
      .filter(includeMatch)
      .map((record) => {
        const match = matchRecord(record);
        return [match.id || `${match.name}|${match.dateTimeGMT || match.date}`, match];
      })
  ).values()]
    .filter((match) => {
      const start = startFor(match);
      return start && start.getTime() > Date.now() - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => startFor(a) - startFor(b));
  console.log(`CricketData match discovery: ${nearTerm.length} near-term records, ${seriesFixtures.length} series fixtures, ${selected.length} selected Tests.`);
  if (!selected.length) console.warn("No upcoming pilot Tests found; publishing a valid empty calendar for this run.");
  return buildCalendar(selected);
}
