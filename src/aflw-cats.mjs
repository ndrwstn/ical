const FIXTURE_URL = "https://www.geelongcats.com.au/news/2027542/geelongs-blockbuster-2026-aflw-fixture-announced";

const VENUES = new Map([
  ["Marvel Stadium", { zone: "Australia/Melbourne", address: "Marvel Stadium, 740 Bourke Street, Docklands VIC 3008, Australia" }],
  ["GMHBA Stadium", { zone: "Australia/Melbourne", address: "GMHBA Stadium, 370 Moorabool Street, South Geelong VIC 3220, Australia" }],
  ["People First Stadium", { zone: "Australia/Brisbane", address: "People First Stadium, Nerang Broadbeach Road, Carrara QLD 4211, Australia" }],
  ["Thomas Farms Oval", { zone: "Australia/Adelaide", address: "Thomas Farms Oval, 155-175 The Parade, Marden SA 5070, Australia" }],
  ["Victoria Park", { zone: "Australia/Melbourne", address: "Victoria Park, Lulie Street, Abbotsford VIC 3067, Australia" }],
  ["IKON Park", { zone: "Australia/Melbourne", address: "IKON Park, 400 Royal Parade, Carlton North VIC 3054, Australia" }],
  ["Sullivan Logistics Stadium", { zone: "Australia/Perth", address: "Sullivan Logistics Stadium, 70 Old Perth Road, Bassendean WA 6054, Australia" }],
]);

function decodeHtml(value = "") {
  return String(value).replace(/<br\s*\/?>\s*/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "user-agent": "ndrwstn-ical/1.0 (+https://github.com/ndrwstn/ical)" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}
function utcFromZoned(year, month, day, hour, minute, timeZone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    guess += wanted - actual;
  }
  return new Date(guess);
}
function parseFixtures(html) {
  const text = decodeHtml(html);
  const table = text.match(/Geelong's 2026 AFLW Fixture([\s\S]*?)(?:Today's Must Read|$)/i)?.[1] || "";
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  const row = new RegExp(`(\\d+)\\s*\\|?\\s*(Geelong(?: Cats)?|North Melbourne|St Kilda|Gold Coast|Essendon|Adelaide|Collingwood|Hawthorn|Richmond|GWS Giants|West Coast|Fremantle|Western Bulldogs)\\s+v\\.?(?:\\s+)(Geelong(?: Cats)?|North Melbourne|St Kilda|Gold Coast|Essendon|Adelaide|Collingwood|Hawthorn|Richmond|GWS Giants|West Coast|Fremantle|Western Bulldogs)\\s*\\|?\\s*([^|]+?)\\s*\\|?\\s*(?:[A-Za-z]+\\s+)?(\\d{1,2})\\s+(${months}),?\\s*(\\d{1,2})\\.(\\d{2})(am|pm)`, "gi");
  const fixtures = [];
  for (const match of table.matchAll(row)) {
    const [, round, home, away, venueRaw, day, monthName, hourText, minuteText, meridiem] = match;
    const venue = venueRaw.replace(/\s+/g, " ").trim();
    const meta = VENUES.get(venue);
    if (!meta) continue;
    let hour = Number(hourText);
    if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;
    const month = new Date(`${monthName} 1, 2026`).getUTCMonth() + 1;
    fixtures.push({ round: Number(round), home: home.replace(/ Cats$/, ""), away: away.replace(/ Cats$/, ""), venue, ...meta, start: utcFromZoned(2026, month, Number(day), hour, Number(minuteText), meta.zone) });
  }
  return fixtures;
}
function esc(value = "") { return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function stamp(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function event({ uid, start, end, title, location, description, status = "CONFIRMED" }) {
  return ["BEGIN:VEVENT", `UID:${uid}@ical.ndrwstn.github.io`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(title)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`, `URL:${FIXTURE_URL}`, `STATUS:${status}`, "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "END:VALARM", "END:VEVENT"].join("\r\n");
}
export async function buildAflwCatsCalendar() {
  const fixtures = parseFixtures(await fetchHtml(FIXTURE_URL));
  if (fixtures.length < 10) throw new Error(`Official Geelong AFLW fixture yielded only ${fixtures.length} matches; refusing to publish an incomplete calendar.`);
  const entries = fixtures.map((fixture) => event({
    uid: `aflw-cats-2026-r${fixture.round}`, start: fixture.start, end: new Date(fixture.start.getTime() + 3 * 60 * 60 * 1000),
    title: `AFLW: ${fixture.home} v. ${fixture.away} — Round ${fixture.round}`, location: fixture.address,
    description: [`Official fixture: ${fixture.home} v. ${fixture.away}`, `Venue: ${fixture.venue}`, `Local time zone: ${fixture.zone}`, `Source: ${FIXTURE_URL}`].join("\n"),
  }));
  const finalsStart = utcFromZoned(2026, 11, 7, 12, 0, "Australia/Melbourne");
  entries.push(event({ uid: "aflw-cats-2026-finals-tba", start: finalsStart, end: new Date(finalsStart.getTime() + 60 * 60 * 1000), title: "AFLW Geelong Finals — TBA", location: "TBA", description: "Placeholder only; it is not a confirmed match.", status: "TENTATIVE" }));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ndrwstn//AFLW Cats//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:AFLW Cats", ...entries, "END:VCALENDAR", ""].join("\r\n");
}