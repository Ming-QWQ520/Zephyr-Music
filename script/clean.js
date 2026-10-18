#!/usr/bin/env node
/**
 * clean.js — 项目清理脚本
 *
 * 清理构建产物、缓存文件和临时文件。
 *
 * 用法：
 *   node script/clean.js          # 清理所有
 *   node script/clean.js --dry    # 试运行，只显示要删除的文件
 *   node script/clean.js --dist   # 只清理 dist
 *   node script/clean.js --target # 只清理 src-tauri/target
 */

import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry");
const onlyDist = args.has("--dist");
const onlyTarget = args.has("--target");

const targets = [
  { path: "dist", desc: "Vite 构建产物" },
  { path: "src-tauri/target", desc: "Rust 编译产物" },
  { path: "src-tauri/gen", desc: "Tauri 生成的 schemas" },
  { path: "node_modules/.vite", desc: "Vite 缓存" },
  { path: "node_modules/.cache", desc: "通用缓存" },
  { path: "coverage", desc: "测试覆盖率报告" },
  { path: "test-results", desc: "测试结果" },
];

function cleanTarget(target) {
  const fullPath = join(root, target.path);
  if (!existsSync(fullPath)) {
    console.log(`  ⊘ ${target.path} — 不存在，跳过`);
    return 0;
  }

  const size = getDirSize(fullPath);
  const sizeStr = formatSize(size);

  if (dryRun) {
    console.log(`  🗑  ${target.path} (${sizeStr}) — ${target.desc} [试运行]`);
  } else {
    try {
      rmSync(fullPath, { recursive: true, force: true });
      console.log(`  ✓ ${target.path} (${sizeStr}) — 已删除`);
    } catch (e) {
      console.error(`  ✗ ${target.path} — 删除失败: ${e.message}`);
      return 0;
    }
  }
  return size;
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += stat.size;
      }
    }
  } catch {
    // 权限不足等错误忽略
  }
  return size;
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

console.log(dryRun ? "🔍 清理试运行（不会实际删除）：" : "🧹 开始清理：");
console.log();

let totalSize = 0;
const filteredTargets = onlyDist
  ? targets.filter(t => t.path === "dist")
  : onlyTarget
    ? targets.filter(t => t.path === "src-tauri/target")
    : targets;

for (const target of filteredTargets) {
  totalSize += cleanTarget(target);
}

console.log();
console.log(`📊 总计释放: ${formatSize(totalSize)}`);
if (dryRun) {
  console.log("💡 去掉 --dry 参数实际执行删除");
}
