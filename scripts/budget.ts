/**
 * Bundle budget. Sums gzipped output per bucket and fails the build if a
 * bucket is over its limit in budget.json.
 *
 * Lightweight is the product, so this runs on every build, not just in CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, sep } from "node:path";

interface Bucket {
  name: string;
  match: string;
  limitKb: number;
}

const DIST = "dist";
const budget: { buckets: Bucket[] } = JSON.parse(
  readFileSync("budget.json", "utf8"),
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function toRegExp(glob: string): RegExp {
  const source = glob
    .split("**/")
    .map((part) =>
      part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
    )
    .join("(?:.*/)?");
  return new RegExp(`^${source}$`);
}

const files = walk(DIST).map((path) => ({
  path: relative(DIST, path).split(sep).join("/"),
  gzip: gzipSync(readFileSync(path), { level: 9 }).byteLength,
}));

let over = false;
const rows = budget.buckets.map((bucket) => {
  const pattern = toRegExp(bucket.match);
  const matched = files.filter((file) => pattern.test(file.path));
  const kb = matched.reduce((sum, file) => sum + file.gzip, 0) / 1024;
  const limit = bucket.limitKb;
  if (kb > limit) over = true;
  return { bucket, kb, limit, count: matched.length };
});

const width = Math.max(...rows.map((row) => row.bucket.name.length));
for (const row of rows) {
  const used = `${row.kb.toFixed(1)} / ${row.limit} KB`;
  const bar = row.kb > row.limit ? "OVER" : `${Math.round((row.kb / row.limit) * 100)}%`;
  console.log(
    `  ${row.bucket.name.padEnd(width)}  ${used.padStart(16)}  ${bar.padStart(5)}  (${row.count} files, gzip)`,
  );
}

const total = rows.reduce((sum, row) => sum + row.kb, 0);
console.log(`  ${"Total".padEnd(width)}  ${`${total.toFixed(1)} KB`.padStart(16)}`);

if (over) {
  console.error("\n  Over budget. Fix the size, or change budget.json and say why.\n");
  process.exit(1);
}
