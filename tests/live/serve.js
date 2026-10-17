const h = require("http"), fs = require("fs"), p = require("path");
const root = process.argv[2], port = +process.argv[3];
h.createServer((q, r) => {
  const f = p.join(root, decodeURIComponent(q.url.split("?")[0]));
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    const t = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" }[p.extname(f)] || "application/octet-stream";
    r.writeHead(200, { "Content-Type": t, "Cache-Control": "no-store" }); r.end(d);
  });
}).listen(port, "127.0.0.1", () => console.log("up " + port));
