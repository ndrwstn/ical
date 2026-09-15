const API = "https://api.squiggle.com.au/?q=";
const YEAR = 2026;
const VENUES = new Map([
  ["GMHBA Stadium", "GMHBA Stadium, 370 Moorabool Street, South Geelong VIC 3220, Australia"],
  ["M.C.G.", "Melbourne Cricket Ground, Brunton Avenue, Richmond VIC 3002, Australia"],
  ["MCG", "Melbourne Cricket Ground, Brunton Avenue, Richmond VIC 3002, Australia"],
  ["Marvel Stadium", "Marvel Stadium, 740 Bourke Street, Docklands VIC 3008, Australia"],
  ["Adelaide Oval", "Adelaide Oval, War Memorial Drive, North Adelaide SA 5006, Australia"],
  ["People First Stadium", "People First Stadium, Nerang Broadbeach Road, Carrara QLD 4211, Australia"],
  ["Gabba", "The Gabba, Vulture Street, Woolloongabba QLD 4102, Australia"],
  ["SCG", "Sydney Cricket Ground, Moore Park Road, Moore Park NSW 2021, Australia"],
  ["Sydney Cricket Ground", "Sydney Cricket Ground, Moore Park Road, Moore Park NSW 2021, Australia"],
  ["Optus Stadium", "Optus Stadium, 333 Victoria Park Drive, Burswood WA 6100, Australia"],
  ["UTAS Stadium", "UTAS Stadium, 27 Invermay Road, Launceston TAS 7248, Australia"],
  ["North Hobart Oval", "North Hobart Oval, 2 Davies Avenue, North Hobart TAS 7000, Australia"],
  ["Heritage Bank Stadium", "Heritage Bank Stadium, Nerang Broadbeach Road, Carrara QLD 4211, Australia"],
  ["Mars Stadium", "Mars Stadium, Creswick Road, Ballarat VIC 3350, Australia"],
  ["Norwood Oval", "Norwood Oval, 4 Woods Street, Norwood SA 5067, Australia"],
  ["TIO Stadium", "TIO Stadium, 70 Abala Road, Marrara NT 0812, Australia"],
  ["Blundstone Arena", "Blundstone Arena, 15 Derwent Street, Bellerive TAS 7018, Australia"],
]);

function escapeIcs(value = "") { return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function stamp(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
async function get(query) {
  const response = await fetch(API + query, { headers: { "user-agent": "ndrwstn-ical/1.0 (https://github.com/ndrwstn/ical)" } });
  if (!response.ok) throw new Error(`${query} returned ${response.status}`);
  return response.json();
}
function roundLabel(game) {
  const finals = { 2: "Elimination Final", 3: "Qualifying Final", 4: "Semi-Final", 5: "Preliminary Final", 6: "Grand Final", 7: "Wildcard Final" };
  return finals[Number(game.is_final)] || `Round ${game.round}`;
}
function event({ uid, start, end, title, location, description, status = "CONFIRMED" }) {
  return ["BEGIN:VEVENT", `UID:${uid}@ical.ndrwstn.github.io`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escapeIcs(title)}`, `LOCATION:${escapeIcs(location)}`, `DESCRIPTION:${escapeIcs(description)}`, `URL:${API}games;year=${YEAR}`, `STATUS:${status}`, "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcs(title)}`, "END:VALARM", "END:VEVENT"].join("\r\n");
}
export async function buildAflCatsCalendar() {
  const [teamsPayload, gamesPayload] = await Promise.all([get(`teams;year=${YEAR}`), get(`games;year=${YEAR}`)]);
  const teams = new Map((teamsPayload.teams || []).map((team) => [Number(team.id), team.name]));
  console.log("AFL API sample", JSON.stringify({ teams: (teamsPayload.teams || []).slice(0, 3), game: (gamesPayload.games || [])[0] }));
  const geelongId = [...teams.entries()].find(([, name]) => /^(Geelong|Geelong Cats)$/i.test(name))?.[0];
  if (!geelongId) throw new Error("Geelong was absent from Squiggle's current teams data.");
  const games = (gamesPayload.games || []).filter((game) => Number(game.hteam) === geelongId || Number(game.ateam) === geelongId)
    .filter((game) => game.date && teams.has(Number(game.hteam)) && teams.has(Number(game.ateam)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (games.length < 20) throw new Error(`Squiggle returned only ${games.length} Geelong games; refusing to publish an incomplete calendar.`);
  const entries = games.map((game) => {
    const home = teams.get(Number(game.hteam));
    const away = teams.get(Number(game.ateam));
    const title = `AFL: ${home} v. ${away} — ${roundLabel(game)}`;
    const venue = VENUES.get(game.venue) || game.venue || "TBD";
    const start = new Date(game.date);
    return event({ uid: `afl-cats-${game.id}`, start, end: new Date(start.getTime() + 3 * 60 * 60 * 1000), title, location: venue, description: [`Fixture: ${home} v. ${away}`, `Venue: ${game.venue || "TBD"}`, `Source: ${API}games;year=${YEAR}`].join("\n") });
  });
  const geelongFinalLoss = games.some((game) => Number(game.is_final) > 1 && Number(game.complete) === 100 && Number(game.winner) && Number(game.winner) !== geelongId);
  const grandFinalExists = games.some((game) => Number(game.is_grand_final) === 1);
  if (!geelongFinalLoss && !grandFinalExists) {
    const placeholderStart = new Date(Date.UTC(YEAR, 8, 26, 4, 30));
    entries.push(event({ uid: `afl-cats-${YEAR}-grand-final-tba`, start: placeholderStart, end: new Date(placeholderStart.getTime() + 60 * 60 * 1000), title: "AFL Geelong Grand Final — TBA", location: "TBA", description: "Placeholder only; it is not a confirmed match.", status: "TENTATIVE" }));
  }
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ndrwstn//AFL Cats//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:AFL Cats", ...entries, "END:VCALENDAR", ""].join("\r\n");
}