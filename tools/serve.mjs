import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const root = join(process.cwd(), "public");
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT ?? 8816);

createServer((request, response) => {
  if (request.method !== "GET") return response.writeHead(405).end("GET only");
  const requested = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  const path = normalize(join(root, requested));
  if ((path !== root && !path.startsWith(root + sep)) || !existsSync(path)) return response.writeHead(404).end("Not found");
  const extension = extname(path);
  response.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream", "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=86400", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://1f916.ai; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", "Referrer-Policy": "no-referrer", "Permissions-Policy": "geolocation=(), microphone=(), camera=()", "X-Content-Type-Options": "nosniff" });
  createReadStream(path).pipe(response);
}).listen(port, () => console.log(`1F916 Monitor: http://localhost:${port}`));
