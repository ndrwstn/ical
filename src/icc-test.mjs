const API_URL = "https://api.cricapi.com/v1/matches";
const CALENDAR_NAME = "icc-test";
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

function isWomenMatch(match, teams) {
  return /women|\bW\b/i.test(String(match.name || match.series || "")) ||
    teams.some((team) => /\s+(Women|W)$/i.test(team));
}

function teamsFor(match) {
  if (Array.isArray(match.teams) && match.teams.length === 2) return match.teams;
  if (Array.isArray(match.teamInfo) && match.teamInfo.length === 2) {
    return match.teamInfo.map((team) => team.name).filter(Boolean);
  }
  return [];
}

function startFor(match) {
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

function buildCalendar(matches) {
  const stamp = utc(new Date());
  const entries = [];
  for (const match of matches) {
    const teams = teamsFor(match);
    const start = startFor(match);
    if (!start || teams.length !== 2) continue;
    const women = isWomenMatch(match, teams);
    const days = women ? 4 : 5;
    const test = testLabel(match);
    const series = String(match.series || "").trim();
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
    "PRODID:-//ndrwstn//ICC Test Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:icc-test",
    ...entries,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function includeMatch(match) {
  const format = String(match.matchType || match.format || "").toLowerCase();
  if (format !== "test") return false;
  const teams = teamsFor(match);
  if (teams.length !== 2) return false;
  const normalized = teams.map(cleanTeam);
  return normalized.every((team) => INTERNATIONAL_TEAMS.has(team)) &&
    normalized.some((team) => PILOT_TEAMS.has(team)) &&
    !match.matchEnded;
}

async function fetchMatches(apiKey) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(API_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`CricketData returned ${response.status}`);
    const body = await response.json();
    const data = Array.isArray(body.data) ? body.data : [];
    all.push(...data);
    const next = body.info?.nextOffset;
    if (!data.length || next === undefined || next === null || Number(next) === offset) break;
    offset = Number(next);
  }
  return all;
}

export async function buildIccTestCalendar(apiKey) {
  if (!apiKey) throw new Error("CRICKETDATA_API_KEY is not configured.");
  const matches = await fetchMatches(apiKey);
  const selected = [...new Map(matches.filter(includeMatch).map((match) => [match.id || `${match.name}|${match.dateTimeGMT || match.date}`, match])).values()]
    .filter((match) => {
      const start = startFor(match);
      return start && start.getTime() > Date.now() - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => startFor(a) - startFor(b));
  if (!selected.length) throw new Error("No upcoming pilot Test fixtures were returned by CricketData.");
  return buildCalendar(selected);
}
