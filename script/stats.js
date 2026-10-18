#!/usr/bin/env node
/**
 * stats.js — 项目统计脚本
 *
 * 统计代码行数、文件数、依赖数等信息。
 *
 * 用法：
 *   node script/stats.js
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const SCAN_DIRS = ["src", "src-tauri/src", "test", "script"];
const SCAN_EXTS = {
  ".ts": { name: "TypeScript", color: "\x1b[36m" },
  ".vue": { name: "Vue", color: "\x1b[32m" },
  ".js": { name: "JavaScript", color: "\x1b[33m" },
  ".rs": { name: "Rust", color: "\x1b[31m" },
  ".css": { name: "CSS", color: "\x1b[35m" },
  ".json": { name: "JSON", color: "\x1b[34m" },
};
const IGNORE_DIRS = ["node_modules", "target", "dist", ".git", "gen", "coverage"];
const IGNORE_FILES = ["pnpm-lock.yaml", "package-lock.json"];

function scanDir(dirPath, stats) {
  if (!existsSync(dirPath)) return;

  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry)) continue;
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      scanDir(fullPath, stats);
    } else {
      const ext = extname(entry);
      if (!SCAN_EXTS[ext]) continue;

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n").length;
      const size = stat.size;

      stats.totalFiles++;
      stats.totalLines += lines;
      stats.totalSize += size;

      if (!stats.byExt[ext]) {
        stats.byExt[ext] = { files: 0, lines: 0, size: 0 };
      }
      stats.byExt[ext].files++;
      stats.byExt[ext].lines += lines;
      stats.byExt[ext].size += size;
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const stats = {
  totalFiles: 0,
  totalLines: 0,
  totalSize: 0,
  byExt: {},
};

console.log("  Zephyr Music 项目统计\n");
console.log("扫描目录:", SCAN_DIRS.join(", "));
console.log();

for (const dir of SCAN_DIRS) {
  scanDir(join(root, dir), stats);
}

console.log("═══════════════════════════════════════");
console.log(` 总文件数: ${stats.totalFiles}`);
console.log(` 总代码行: ${stats.totalLines.toLocaleString()}`);
console.log(` 总大小:   ${formatSize(stats.totalSize)}`);
console.log("═══════════════════════════════════════");
console.log();

console.log("按语言统计:");
console.log("─".repeat(50));
const sortedExts = Object.entries(stats.byExt).sort((a, b) => b[1].lines - a[1].lines);
for (const [ext, data] of sortedExts) {
  const info = SCAN_EXTS[ext];
  const pct = ((data.lines / stats.totalLines) * 100).toFixed(1);
  const bar = "█".repeat(Math.round(parseFloat(pct) / 2)).padEnd(25, "░");
  console.log(`  ${info.color}${info.name.padEnd(12)}\x1b[0m ${data.files.toString().padStart(3)} 文件  ${data.lines.toString().padStart(6)} 行  ${bar} ${pct}%`);
}
console.log();

// 依赖统计
if (existsSync(join(root, "package.json"))) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  const depCount = Object.keys(pkg.dependencies || {}).length;
  const devDepCount = Object.keys(pkg.devDependencies || {}).length;
  console.log("依赖统计:");
  console.log("─".repeat(50));
  console.log(`     运行时依赖: ${depCount}`);
  console.log(`     开发依赖:   ${devDepCount}`);
  console.log(`     总计:       ${depCount + devDepCount}`);
}
