// Dev server: serves app/ and a forecast fixture so the app runs offline, e.g.
//   http://localhost:5173/?weather=/fixture.json&theme=forecast
// PORT=5174 bun scripts/serve.ts serves on another port.

const PORT = Number(process.env.PORT) || 5173;
const root = new URL("../app/", import.meta.url).pathname;
const fixture = new URL("../test/fixtures/forecast.json", import.meta.url).pathname;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/fixture.json") return new Response(Bun.file(fixture));
    // Resolve inside app/ only: reject anything that climbs out of it.
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    if (rel.split("/").includes("..")) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(root + rel);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`http://localhost:${server.port}/?weather=/fixture.json&theme=forecast`);
