#!/usr/bin/env node
/**
 * dev.js — 开发环境快速启动脚本
 *
 * 检查依赖、环境变量，然后启动开发服务器。
 *
 * 用法：
 *   node script/dev.js          # 启动完整开发环境
 *   node script/dev.js --web    # 只启动前端（不启动 Tauri）
 *   node script/dev.js --check  # 只检查环境，不启动
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const webOnly = args.has("--web");
const checkOnly = args.has("--check");

function checkNode() {
  try {
    const version = execSync("node --version", { encoding: "utf-8" }).trim();
    const major = parseInt(version.slice(1));
    console.log(`  ✓ Node.js ${version}`);
    if (major < 18) {
      console.warn(`  ⚠ Node.js 版本过低，建议 >= 18`);
    }
    return true;
  } catch {
    console.error("  ✗ Node.js 未安装");
    return false;
  }
}

function checkPnpm() {
  try {
    const version = execSync("pnpm --version", { encoding: "utf-8" }).trim();
    console.log(`  ✓ pnpm ${version}`);
    return true;
  } catch {
    console.error("  ✗ pnpm 未安装，请运行: npm install -g pnpm");
    return false;
  }
}

function checkRust() {
  if (webOnly) return true;
  try {
    const version = execSync("rustc --version", { encoding: "utf-8" }).trim();
    console.log(`  ✓ ${version}`);
    return true;
  } catch {
    console.error("  ✗ Rust 未安装，请运行: https://rustup.rs");
    return false;
  }
}

function checkDeps() {
  const nodeModulesPath = join(root, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    console.log("  📦 node_modules 不存在，正在安装依赖...");
    try {
      execSync("pnpm install", { cwd: root, stdio: "inherit" });
      console.log("  ✓ 依赖安装完成");
      return true;
    } catch {
      console.error("  ✗ 依赖安装失败");
      return false;
    }
  }
  console.log("  ✓ node_modules 已存在");
  return true;
}

function checkTauriCli() {
  if (webOnly) return true;
  try {
    execSync("npx tauri --version", { cwd: root, encoding: "utf-8" });
    console.log("  ✓ Tauri CLI 可用");
    return true;
  } catch {
    console.warn("  ⚠ Tauri CLI 不可用，将尝试通过 pnpm tauri 启动");
    return true; // 不阻断，让 pnpm tauri 尝试
  }
}

function checkEnv() {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    console.error("  ✗ package.json 不存在");
    return false;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  console.log(`  ✓ 项目: ${pkg.name} v${pkg.version}`);
  return true;
}

console.log("🔍 检查开发环境...\n");

const checks = [
  checkNode(),
  checkPnpm(),
  checkRust(),
  checkDeps(),
  checkTauriCli(),
  checkEnv(),
];

const allOk = checks.every(Boolean);
console.log();

if (!allOk) {
  console.error("❌ 环境检查未通过，请修复上述问题");
  process.exit(1);
}

if (checkOnly) {
  console.log("✅ 环境检查通过！");
  process.exit(0);
}

console.log("🚀 启动开发服务器...\n");

const cmd = webOnly ? ["pnpm", ["dev"]] : ["pnpm", ["tauri", "dev"]];
const child = spawn(cmd[0], cmd[1], {
  cwd: root,
  stdio: "inherit",
  shell: true, 
  env: { ...process.env, FORCE_COLOR: "1" },
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
