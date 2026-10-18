#!/usr/bin/env node
/**
 * test-runner.js — 测试运行脚本
 *
 * 运行测试并生成报告。
 *
 * 用法：
 *   node script/test-runner.js           # 运行所有测试
 *   node script/test-runner.js --watch   # 监视模式
 *   node script/test-runner.js --coverage # 生成覆盖率报告
 *   node script/test-runner.js --ui      # 打开 Vitest UI
 */

import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const coverage = args.includes("--coverage");
const ui = args.includes("--ui");

function buildCmd() {
  const parts = ["npx", "vitest"];

  if (ui) {
    parts.push("--ui");
    return parts;
  }

  if (watch) {
    parts.push("--watch");
  } else {
    parts.push("run");
  }

  if (coverage) {
    parts.push("--coverage");
  }

  // 传入额外的过滤参数（非 -- 开头的）
  const filter = args.filter(a => !a.startsWith("--"));
  if (filter.length > 0) {
    parts.push(...filter);
  }

  return parts;
}

console.log("🧪 Zephyr Music 测试运行器\n");

const cmdParts = buildCmd();
console.log(`命令: ${cmdParts.join(" ")}\n`);

const child = spawn(cmdParts[0], cmdParts.slice(1), {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, FORCE_COLOR: "1" },
});

child.on("close", (code) => {
  if (code === 0) {
    console.log("\n✅ 测试通过！");
  } else {
    console.error(`\n❌ 测试失败 (exit code: ${code})`);
  }
  process.exit(code ?? 1);
});
