#!/usr/bin/env node
/**
 * package.js — 打包发布脚本
 *
 * 清理 → 构建 → 打包为 zip。
 *
 * 用法：
 *   node script/package.js                    # 打包到 download/
 *   node script/package.js --output custom.zip # 自定义输出文件名
 *   node script/package.js --skip-build       # 跳过构建直接打包
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join, basename } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const outputName = outputIdx >= 0 ? args[outputIdx + 1] : "Zephyr-Music-WIP.zip";
const skipBuild = args.includes("--skip-build");

const downloadDir = join(root, "..", "download");
if (!existsSync(downloadDir)) {
  mkdirSync(downloadDir, { recursive: true });
}

const outputPath = join(downloadDir, outputName);

const EXCLUDE_PATTERNS = [
  "node_modules",
  "target",
  "dist",
  ".git",
  "src-tauri/target",
  "src-tauri/gen",
  "src-tauri/Cargo.lock",
  "coverage",
  "test-results",
  ".DS_Store",
  "*.log",
];

function shouldExclude(path) {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\./g, "\\.").replace(/\*/g, ".*"));
      return regex.test(path);
    }
    return path === pattern || path.startsWith(pattern + "/") || path.startsWith(pattern + "\\");
  });
}

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log("─".repeat(50));
  const start = Date.now();
  try {
    execSync(cmd, { cwd: root, stdio: "inherit" });
    console.log(`✓ ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return true;
  } catch {
    console.error(`✗ ${label} 失败`);
    return false;
  }
}

console.log("📦 Zephyr Music 打包脚本\n");

// 1. 清理旧文件
if (existsSync(outputPath)) {
  console.log(`🗑  删除旧的 ${outputName}`);
  rmSync(outputPath);
}

// 2. 构建
if (!skipBuild) {
  const buildOk = run("node script/build.js --skip-test", "项目构建");
  if (!buildOk) {
    console.error("❌ 构建失败，终止打包");
    process.exit(1);
  }
}

// 3. 打包 zip
console.log("\n▶ 打包 ZIP");
console.log("─".repeat(50));

try {
  // 使用系统 zip 命令
  const excludeArgs = EXCLUDE_PATTERNS.flatMap(p => ["-x", `*/${p}/*`]).concat(
    EXCLUDE_PATTERNS.flatMap(p => ["-x", p])
  );

  // 改用更简单的方式：直接 zip 整个项目目录
  const cmd = `zip -qr "${outputPath}" . ${EXCLUDE_PATTERNS.map(p => `-x "${p}/*"`).join(" ")} -x "${EXCLUDE_PATTERNS.join('" -x "')}"`;
  execSync(cmd, { cwd: root, stdio: "inherit" });

  const size = statSync(outputPath).size;
  const sizeStr = size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;

  console.log(`✓ 打包完成: ${outputPath} (${sizeStr})`);
} catch (e) {
  console.error("✗ 打包失败:", e.message);
  console.log("💡 提示：确保系统已安装 zip 命令");
  process.exit(1);
}

console.log("\n" + "═".repeat(50));
console.log("✅ 打包成功！");
console.log(`📁 输出: ${outputPath}`);
