const UFC_EVENTS_URL = "https://www.ufc.com/events";

function stripHtml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function ics(value = "") { return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function utc(value) { return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function walk(value, events) {
  if (Array.isArray(value)) return value.forEach((item) => walk(item, events));
  if (!value || typeof value !== "object") return;
  const date = value.startDate || value.start_date || value.eventDate || value.event_date;
  const name = value.name || value.title || value.eventName || value.event_name;
  const url = value.url || value.eventUrl || "";
  if (typeof date === "string" && typeof name === "string" && (name.toUpperCase().startsWith("UFC") || url.includes("/event/ufc-"))) events.push({ date, name, url: url || UFC_EVENTS_URL });
  Object.values(value).forEach((item) => walk(item, events));
}
function parseEvents(source) {
  const raw = [];
  // JSON-LD includes non-UFC promotions too; walk() accepts only UFC-named
  // objects or official /event/ufc- URLs.
  for (const match of source.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(match[1]), raw); } catch {} }
  for (const match of source.matchAll(/<h3[^>]*c-card-event--result__headline[^>]*>\s*<a href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>[\s\S]{0,1800}?data-card-event-title=["'][^"']*["']/gi)) {
    const title = stripHtml(match[2]);
    const url = `https://www.ufc.com${match[1]}`;
    if (!/\/event\/ufc-/i.test(url)) continue;
    const cards = [
      ["data-early-card-timestamp", "Early Prelims", 2],
      ["data-prelims-card-timestamp", "Prelims", 2],
      ["data-main-card-timestamp", "Main Card", 4],
    ];
    const scheduledCards = [];
    for (const [attribute, label, durationHours] of cards) {
      const timestamp = match[0].match(new RegExp(`${attribute}=["'](\\d+)["']`, "i"))?.[1];
      if (timestamp) scheduledCards.push({ date: new Date(Number(timestamp) * 1000), label, durationHours });
    }
    for (const [index, card] of scheduledCards.entries()) {
      raw.push({ url, date: card.date.toISOString(), endDate: scheduledCards[index + 1]?.date?.toISOString(), name: `${title} — ${card.label}`, stage: card.label, durationHours: card.durationHours });
    }
  }
  for (const match of source.matchAll(/href=["'](\/event\/ufc-[^"'#?]+)["'][\s\S]{0,2500}?<time[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi)) raw.push({ url: `https://www.ufc.com${match[1]}`, date: match[2], name: stripHtml(match[3]) });
  const now = Date.now() - 86400000;
  return [...new Map(raw.map((event) => { const date = new Date(event.date); const url = event.url.startsWith("http") ? event.url : `https://www.ufc.com${event.url}`; const endDate = event.endDate ? new Date(event.endDate) : null; return [`${event.name}|${date}`, { name: stripHtml(event.name), stage: event.stage || "Main Card", date, endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null, url, durationHours: event.durationHours || 4 }]; })).values()].filter((event) => event.name && !Number.isNaN(event.date.getTime()) && event.date.getTime() > now).sort((a, b) => a.date - b.date);
}
function division(code) {
  const value = stripHtml(code).replace(/\s*Bout\s*/i, "").replace(/Women['’]s\s*/i, "").trim().toLowerCase();
  const abbreviations = { "strawweight": "SW", "flyweight": "FLW", "bantamweight": "BW", "featherweight": "FW", "lightweight": "LW", "welterweight": "WW", "middleweight": "MW", "light heavyweight": "LHW", "heavyweight": "HW", "catchweight": "CW" };
  const base = Object.entries(abbreviations).find(([name]) => value.endsWith(name))?.[1] || value.toUpperCase();
  return /women/i.test(stripHtml(code)) ? `W/${base}` : base;
}
function rank(value) { const match = value.match(/#(\d+)/); return match ? ` (#${match[1]})` : ""; }
function fightNotes(source) {
  const fights = [];
  for (const block of source.matchAll(/<div class="c-listing-fight"[\s\S]*?(?=<div class="c-listing-fight"|$)/gi)) {
    const weightClass = division(block[0].match(/c-listing-fight__class-text[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    const names = block[0].match(/c-listing-fight__corner-name[^>]*--red[^>]*>([\s\S]*?)<\/div>\s*<div class="c-listing-fight__vs[^>]*>[\s\S]*?<\/div>\s*<div class="c-listing-fight__corner-name[^>]*--blue[^>]*>([\s\S]*?)<\/div>/i);
    const ranks = [...block[0].matchAll(/c-listing-fight__corner-rank[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => rank(stripHtml(match[1])));
    if (names) fights.push(`- (${weightClass}) ${stripHtml(names[1])}${ranks[0] || ""} v. ${stripHtml(names[2])}${ranks[1] || ""}`);
  }
  return fights.length ? fights.slice(0, 20).join("\n") : "Fight card details are not yet posted.";
}
function fightNotesByStage(source) {
  const mainStart = source.indexOf('class="fight-card"');
  const prelimStart = source.indexOf('id="prelims-card--');
  const earlyStart = source.indexOf('id="early-prelims--');
  const main = source.slice(mainStart >= 0 ? mainStart : 0, prelimStart >= 0 ? prelimStart : source.length);
  const prelims = prelimStart >= 0 ? source.slice(prelimStart, earlyStart >= 0 ? earlyStart : source.length) : "";
  const earlyPrelims = earlyStart >= 0 ? source.slice(earlyStart) : "";
  let prefix = stripHtml(source.match(/c-hero__headline-prefix[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "UFC");
  prefix = prefix.match(/UFC\s+\d+\b/i)?.[0] || prefix.replace(/^UFC Fight Night$/i, "UFC FN");
  const red = stripHtml(source.match(/e-divider__top[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const blue = stripHtml(source.match(/e-divider__bottom[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const venue = stripHtml(source.match(/field--name-venue[\s\S]*?field__item">([\s\S]*?)<\/div>/i)?.[1] || "");
  const localTime = stripHtml(source.match(/c-hero__headline-suffix[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1] || "");
  const knownHeadliners = red && blue && !/^\?+$/.test(red) && !/^\?+$/.test(blue);
  return { title: knownHeadliners ? `${prefix}: ${red} v. ${blue}` : prefix, venue, localTime, notes: { "Main Card": fightNotes(main), Prelims: fightNotes(prelims), "Early Prelims": fightNotes(earlyPrelims) } };
}
async function fullAddress(venue) {
  if (!venue) return "";
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(venue)}`, { headers: { "user-agent": "UFC Event Calendar (personal calendar feed)" }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const result = await response.json();
    return result?.[0]?.display_name || venue;
  } catch { return venue; }
}
async function fetchFightNotes(url) {
  try {
    const response = await fetch(url, { headers: { "user-agent": "UFC Event Calendar (personal calendar feed)", accept: "text/html" }, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!response.ok) return { notes: {} };
    const details = fightNotesByStage(await response.text());
    details.address = await fullAddress(details.venue);
    return details;
  } catch { return { notes: {} }; }
}
async function buildCalendar() {
  const response = await fetch(UFC_EVENTS_URL, { headers: { "user-agent": "UFC Event Calendar (personal calendar feed)", accept: "text/html" }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error(`UFC returned ${response.status}`);
  const events = parseEvents(await response.text());
  if (!events.length) throw new Error("No upcoming UFC events could be read from the official listing.");
  const notesByUrl = new Map(await Promise.all([...new Set(events.map((event) => event.url))].map(async (url) => [url, await fetchFightNotes(url)])));
  const stamp = utc(new Date());
  const entries = events.map((event) => { const end = event.endDate || new Date(event.date.getTime() + event.durationHours * 60 * 60 * 1000); const details = notesByUrl.get(event.url) || { notes: {} }; const notes = details.notes?.[event.stage] || "Fight card details are not yet posted."; const description = `${notes}\n\nVenue local time: ${details.localTime || "TBD"}\nEvent details: ${event.url}`; const title = details.title ? `${details.title}${event.stage === "Main Card" ? "" : ` — ${event.stage}`}` : event.name; return ["BEGIN:VEVENT", `UID:${encodeURIComponent(event.url + event.name)}@ufc-events-calendar`, `DTSTAMP:${stamp}`, `DTSTART:${utc(event.date)}`, `DTEND:${utc(end)}`, `SUMMARY:${ics(title)}`, `LOCATION:${ics(details.address || details.venue || "TBD")}`, `DESCRIPTION:${ics(description)}`, `URL:${event.url}`, "STATUS:CONFIRMED", "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", `DESCRIPTION:${ics(title)}`, "END:VALARM", "END:VEVENT"].join("\r\n"); });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UFC Event Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:UFC Events", ...entries, "END:VCALENDAR", ""].join("\r\n");
}

export { buildCalendar };
