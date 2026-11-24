// Stand-in for api.weather.gov on port 3098 (same shapes as the real service)
import http from "node:http";
const B = "http://127.0.0.1:3098";
const iso = d => new Date(d).toISOString();
const hour0 = new Date(); hour0.setMinutes(0, 0, 0);
const periods = Array.from({ length: 24 }, (_, i) => ({
  number: i + 1, startTime: iso(hour0.getTime() + i * 3600e3), endTime: iso(hour0.getTime() + (i + 1) * 3600e3),
  isDaytime: ((hour0.getHours() + i) % 24) >= 6 && ((hour0.getHours() + i) % 24) < 18, temperature: 72 + (i < 6 ? i : 6 - (i - 6)), temperatureUnit: "F",
  probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: [10, 10, 20, 20, 40, 60, 70, 50, 30, 20, 10, 10][i] ?? 5 },
  windSpeed: i < 4 ? "10 mph" : "10 to 15 mph", windDirection: "SE", shortForecast: i < 4 ? "Partly Sunny" : i < 8 ? "Showers And Thunderstorms Likely" : "Mostly Cloudy",
}));
const routes = {
  "/points/30.3700,-91.0100": { properties: { forecast: `${B}/gridpoints/LIX/50,100/forecast`, forecastHourly: `${B}/gridpoints/LIX/50,100/forecast/hourly`, observationStations: `${B}/gridpoints/LIX/50,100/stations` } },
  "/gridpoints/LIX/50,100/stations": { features: [{ properties: { stationIdentifier: "KBTR" } }] },
  "/stations/KBTR/observations/latest": { properties: { timestamp: iso(Date.now() - 20 * 60e3), textDescription: "Partly Cloudy",
    temperature: { unitCode: "wmoUnit:degC", value: 23.3 }, heatIndex: { unitCode: "wmoUnit:degC", value: 25.6 }, windChill: { value: null },
    windDirection: { unitCode: "wmoUnit:degree_(angle)", value: 140 }, windSpeed: { unitCode: "wmoUnit:km_h-1", value: 18.36 },
    windGust: { unitCode: "wmoUnit:km_h-1", value: 38.9 }, relativeHumidity: { value: 78.2 } } },
  "/gridpoints/LIX/50,100/forecast/hourly": { properties: { periods } },
  "/gridpoints/LIX/50,100/forecast": { properties: { periods: [{ name: "Today", temperature: 79, isDaytime: true, shortForecast: "Showers And Thunderstorms Likely" }] } },
};
http.createServer((req, res) => {
  if (!/SGFD Nexus/.test(req.headers["user-agent"] || "")) { res.writeHead(403); return res.end("{}"); }
  const u = new URL(req.url, B);
  let body = routes[u.pathname];
  if (u.pathname === "/alerts/active") body = process.env.NO_ALERTS ? { features: [] } : { features: [
    { properties: { event: "Severe Thunderstorm Warning", severity: "Severe", status: "Actual", messageType: "Alert", headline: "Severe Thunderstorm Warning issued for East Baton Rouge Parish", ends: iso(Date.now() + 45 * 60e3), instruction: "Move to an interior room on the lowest floor of a building." } },
    { properties: { event: "Flood Advisory", severity: "Minor", status: "Actual", messageType: "Alert", headline: "Flood Advisory", ends: iso(Date.now() + 3 * 3600e3) } }] };
  if (!body) { res.writeHead(404); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/geo+json" }); res.end(JSON.stringify(body));
}).listen(3098, "127.0.0.1", () => console.log("nws mock on 3098"));
