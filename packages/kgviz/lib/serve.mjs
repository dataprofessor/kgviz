import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function serve(file, port = 8765) {
  const abs = resolve(file);
  const html = await readFile(abs, "utf8");
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    if (path === "/" || path.endsWith(".html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  await new Promise(resolveListen => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Serving ${abs}`);
      console.log(`Open: http://127.0.0.1:${port}/`);
      resolveListen();
    });
  });
}
