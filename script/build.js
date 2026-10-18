#!/usr/bin/env node
/**
 * build.js — 构建脚本
 *
 * 完整的构建流程：类型检查 → 单元测试 → Vite 构建 → Tauri 构建。
 *
 * 用法：
 *   node script/build.js           # 完整构建
 *   node script/build.js --skip-test  # 跳过测试
 *   node script/build.js --skip-tsc   # 跳过类型检查
 *   node script/build.js --check      # 只检查，不构建
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const skipTest = args.has("--skip-test");
const skipTsc = args.has("--skip-tsc");
const checkOnly = args.has("--check");

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log("─".repeat(50));
  const start = Date.now();
  try {
    execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } });
    const ms = Date.now() - start;
    console.log(`✓ ${label} (${(ms / 1000).toFixed(1)}s)`);
    return true;
  } catch (e) {
    console.error(`✗ ${label} 失败`);
    return false;
  }
}

async function main() {
  console.log("🔨 Zephyr Music 构建流程\n");

  const steps = [];

  // 1. 类型检查
  if (!skipTsc) {
    steps.push({ cmd: "npx vue-tsc --noEmit", label: "TypeScript 类型检查" });
  }

  // 2. 单元测试
  if (!skipTest && !checkOnly) {
    steps.push({ cmd: "npx vitest run", label: "单元测试" });
  }

  // 3. ESLint
  steps.push({ cmd: "npx eslint . --ext .ts,.tsx,.vue,.js,.mjs,.cjs", label: "ESLint 代码检查" });

  if (checkOnly) {
    console.log("🔍 仅检查模式，跳过构建步骤");
  } else {
    // 4. Vite 构建
    steps.push({ cmd: "npx vite build", label: "Vite 前端构建" });

    // 5. Tauri 构建（可选，生产环境）
    if (args.has("--tauri")) {
      steps.push({ cmd: "npx tauri build", label: "Tauri 桌面应用构建" });
    }
  }

  let allPassed = true;
  for (const step of steps) {
    const ok = run(step.cmd, step.label);
    if (!ok) {
      allPassed = false;
      break;
    }
  }

  console.log("\n" + "═".repeat(50));
  if (allPassed) {
    console.log("✅ 构建成功！");
  } else {
    console.error("❌ 构建失败！");
    process.exit(1);
  }
}

main();
