// Chép giao diện web/ (nguồn duy nhất, dùng chung với trang Vercel) sang www/ cho app Android,
// gói src/native-ble.js thành 1 file và chèn nó TRƯỚC app.js. Sửa giao diện thì sửa web/ rồi build lại.
import { build } from "esbuild";
import { cpSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const web = join(root, "..", "web");
const www = join(root, "www");

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(web, www, { recursive: true, filter: (p) => !p.endsWith("README.md") });

await build({
  entryPoints: [join(root, "src", "native-ble.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  outfile: join(www, "native-ble.js"),
  logLevel: "warning",
});

const indexPath = join(www, "index.html");
let html = readFileSync(indexPath, "utf8");
const tag = '<script src="app.js"></script>';
if (!html.includes(tag)) throw new Error("Không thấy " + tag + " trong web/index.html");
html = html.replace(tag, '<script src="native-ble.js"></script>\n' + tag);
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
writeFileSync(indexPath, html);
console.log("www/ đã sẵn sàng (web/ + native-ble.js)");
