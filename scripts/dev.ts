// `bun run dev`: serves app/ (scripts/serve.ts) and rebuilds app/style.css with Tailwind on every change to
// src/ or app/index.html. app/main.js is built once by `bun run build` first; re-run it after editing a .ts file.

// --watch=always: plain --watch quits when its stdin closes, and the children get none.
const children = [
  Bun.spawn(["bunx", "tailwindcss", "-i", "src/tailwind.css", "-o", "app/style.css", "--watch=always"], {
    stdio: ["ignore", "inherit", "inherit"],
  }),
  Bun.spawn(["bun", "scripts/serve.ts"], { stdio: ["ignore", "inherit", "inherit"] }),
];

const stopAll = () => {
  for (const c of children) c.kill();
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

// Either one ending takes the other down, so a dead server never leaves a watcher behind.
await Promise.race(children.map((c) => c.exited));
stopAll();

export {};
