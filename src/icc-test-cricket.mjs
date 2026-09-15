const TRACKED_TEAMS = new Set(["Australia", "England", "India", "New Zealand", "South Africa"]);
const INTERNATIONAL_TEAMS = new Set([
  "Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland",
  "New Zealand", "Pakistan", "South Africa", "Sri Lanka", "West Indies", "Zimbabwe"
]);

const CA_HOME = "https://www.cricket.com.au/";
const ECB_2027 = "https://www.ecb.co.uk/news/4539854";

function decodeHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2013;|&ndash;/gi, "–")
    .replace(/&#x2019;|&rsquo;/gi, "’")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTeam(value = "") {
  return String(value).replace(/\s+(Men|Women|W)$/i, "").trim();
}

function isWomen(value = "") {
  return /\bwomen\b|\bwhite ferns\b/i.test(value);
}

function eligible(teams) {
  const normalized = teams.map(cleanTeam);
  return normalized.length === 2 && normalized.every((team) => INTERNATIONAL_TEAMS.has(team)) &&
    normalized.some((team) => TRACKED_TEAMS.has(team));
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "user-agent": "ndrwstn-ical/1.0 (+https://github.com/ndrwstn/ical)" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function caFixtureData(html) {
  const match = html.match(/window\.FIXTURES_DATA\s*=\s*JSON\.parse\('([\s\S]*?)'\);/);
  if (!match) return [];
  // The payload is a JavaScript single-quoted string containing JSON.
  // Quote escapes protect that outer string; unicode escapes still belong to
  // the JSON payload and are deliberately left for JSON.parse to handle.
  return JSON.parse(match[1].replace(/\\'/g, "'").replace(/\\"/g, '"'));
}

function caSeriesUrls(homepage) {
  const urls = new Set();
  for (const match of homepage.matchAll(/href="([^"?#]*\/matches\/series\/[^"?#]+)"/gi)) {
    const url = new URL(match[1], CA_HOME).toString();
    if (/test|anniversary/i.test(url)) urls.add(url);
  }
  return [...urls];
}

function caFixtures(fixtures, sourceUrl) {
  return fixtures
    .filter((fixture) => fixture?.gameType === "Test" && !fixture.isCompleted)
    .map((fixture) => {
      const teams = [fixture.homeTeam?.name, fixture.awayTeam?.name].filter(Boolean);
      return {
        id: `ca-${fixture.id}`,
        teams: teams.map(cleanTeam),
        women: Boolean(fixture.isWomensMatch) || isWomen(`${fixture.competition?.name} ${teams.join(" ")}`),
        label: fixture.name || "Test",
        series: fixture.competition?.name || "",
        start: fixture.startDateTime,
        days: Number(fixture.numberOfDays) || (fixture.isWomensMatch ? 4 : 5),
        venue: [fixture.venue?.name, fixture.venue?.location].filter(Boolean).join(", "),
        sourceUrl,
      };
    })
    .filter((fixture) => eligible(fixture.teams));
}

function ecbDate(text) {
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  const re = new RegExp(`(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\\s*(\\d{1,2})(?:\\s*[–-]\\s*\\d{1,2})?\\s+(${months})(?:\\s*[–-]\\s*\\d{1,2}\\s+${months})?`, "i");
  const match = text.match(re);
  if (!match) return null;
  const year = 2027;
  const date = new Date(`${match[2]} ${match[1]}, ${year} 11:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ecbTeams(title) {
  const match = title.match(/(England)(?:\s+(Men|Women))?\s+v\.?\s+(Australia|Bangladesh|India|New Zealand|South Africa)(?:\s+(Men|Women))?/i);
  if (!match) return null;
  return { teams: ["England", cleanTeam(match[3])], women: /women/i.test(`${match[2] || ""} ${match[4] || ""}`) };
}

function ecbFixtures(html) {
  const fixtures = [];
  let currentSection = null;
  for (const paragraph of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = paragraph[1];
    const strong = raw.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (strong) {
      const heading = decodeHtml(strong[1]);
      const teams = ecbTeams(heading);
      currentSection = teams && eligible(teams.teams) ? { ...teams, heading } : null;
    }
    if (!currentSection) continue;
    for (const fragment of raw.split(/<br\s*\/?>/i)) {
      const text = decodeHtml(fragment);
      if (!/\btest\b/i.test(text)) continue;
      const start = ecbDate(text);
      if (!start) continue;
      const testMatch = text.match(/(?:only|\d+(?:st|nd|rd|th))[^:]{0,50}\btest(?:\s+match)?/i);
      if (!testMatch) continue;
      const test = testMatch[0];
      const venue = text.match(/\btest(?:\s+match)?\s*[–-]\s*([^,]+(?:,\s*[^,]+)?)/i)?.[1]?.replace(/,\s*\d{3,4}\s*$/, "") || "TBD";
      fixtures.push({
        id: `ecb-${encodeURIComponent(`${currentSection.teams.join("-")}-${start}-${test}`)}`,
        teams: currentSection.teams,
        women: currentSection.women,
        label: test.replace(/\s+match$/i, ""),
        series: currentSection.heading,
        start,
        days: currentSection.women ? 4 : 5,
        venue,
        sourceUrl: ECB_2027,
      });
    }
  }
  return fixtures;
}

function dedupe(fixtures) {
  return [...new Map(fixtures.map((fixture) => [
    `${fixture.teams.join("|")}|${fixture.start}|${fixture.women}`,
    fixture,
  ])).values()].sort((a, b) => new Date(a.start) - new Date(b.start));
}

function escapeIcs(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function utc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function buildCalendar(fixtures) {
  const stamp = utc(new Date());
  const events = [];
  for (const fixture of fixtures) {
    const start = new Date(fixture.start);
    for (let day = 1; day <= fixture.days; day += 1) {
      const dayStart = new Date(start.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 7 * 60 * 60 * 1000);
      const title = `${fixture.women ? "Women’s " : ""}${fixture.teams[0]} v. ${fixture.teams[1]} — ${fixture.label} — Day ${day}`;
      const description = [
        fixture.series && `Series: ${fixture.series}`,
        "Scheduled day estimate; actual play may change due to weather, light, or match conditions.",
        "Times use the board's scheduled match start where provided.",
        `Official board source: ${fixture.sourceUrl}`,
      ].filter(Boolean).join("\n");
      events.push([
        "BEGIN:VEVENT",
        `UID:${fixture.id}-day-${day}@ical.ndrwstn.github.io`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(dayStart)}`,
        `DTEND:${utc(dayEnd)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `LOCATION:${escapeIcs(fixture.venue || "TBD")}`,
        `DESCRIPTION:${escapeIcs(description)}`,
        `URL:${fixture.sourceUrl}`,
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
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ndrwstn//ICC Test Cricket//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:ICC Test Cricket",
    ...events, "END:VCALENDAR", "",
  ].join("\r\n");
}

export async function buildIccTestCricketCalendar() {
  const [caHome, ecbHtml] = await Promise.all([fetchHtml(CA_HOME), fetchHtml(ECB_2027)]);
  const caUrls = caSeriesUrls(caHome);
  if (!caUrls.length) throw new Error("Cricket Australia no longer exposed Test series links on its public schedule page.");
  const caPages = await Promise.all(caUrls.map(async (url) => ({ url, html: await fetchHtml(url) })));
  const ca = caPages.flatMap(({ url, html }) => caFixtures(caFixtureData(html), url));
  const ecb = ecbFixtures(ecbHtml);
  const fixtures = dedupe([...ca, ...ecb]).filter((fixture) => new Date(fixture.start).getTime() >= Date.now() - 24 * 60 * 60 * 1000);
  console.log(`Official board discovery: Cricket Australia ${ca.length} Tests; ECB ${ecb.length} Tests; ${fixtures.length} selected.`);
  if (!fixtures.length) throw new Error("Official board sources produced no upcoming eligible Tests; refusing to overwrite the existing calendar.");
  return { calendar: buildCalendar(fixtures), fixtures };
}
