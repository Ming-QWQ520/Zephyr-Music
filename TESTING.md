# 测试与脚本

本项目使用 [Vitest](https://vitest.dev/) 作为单元测试框架，`script/` 目录包含常用自动化脚本。

## 测试

### 运行测试

```bash
# 运行所有测试（一次性）
pnpm test

# 监视模式（文件变更自动重跑）
pnpm test:watch

# 打开 Vitest 可视化 UI
pnpm test:ui

# 生成覆盖率报告
pnpm test:coverage
```

### 测试文件结构

```
test/
├── format.test.ts       # 格式化工具函数（时间/数字/日志截断）
├── useToast.test.ts     # Toast 通知系统（添加/移除/自动消失）
├── md5.test.ts          # MD5 哈希计算（RFC 1321 标准测试向量）
├── cc.test.ts           # 入口路由哨兵（防误删机制）
└── clouddisk.test.ts    # 云盘工具函数（歌名/艺术家/封面提取）
```

### 编写测试

测试文件放在 `test/` 目录，文件名以 `.test.ts` 结尾。Vitest 会自动发现。

```typescript
import { describe, it, expect } from "vitest";
import { formatTime } from "@/utils/format";

describe("formatTime", () => {
  it("格式化 0 秒", () => {
    expect(formatTime(0)).toBe("0:00");
  });
});
```

使用 `@` 别名引用 `src/` 下的模块（已在 `vitest.config.ts` 配置）。

## 脚本

`script/` 目录包含以下自动化脚本：

### clean.js — 项目清理

```bash
# 清理所有构建产物和缓存
pnpm clean

# 试运行（只显示要删除的文件，不实际删除）
pnpm clean:dry

# 只清理 dist
node script/clean.js --dist

# 只清理 Rust target
node script/clean.js --target
```

清理目标：`dist`、`src-tauri/target`、`src-tauri/gen`、`node_modules/.vite`、`coverage` 等。

### stats.js — 项目统计

```bash
pnpm stats
```

统计代码行数、文件数、按语言分布、依赖数量。

### build.js — 完整构建

```bash
# 完整构建（类型检查 + 测试 + ESLint + Vite）
pnpm build:full

# 只检查（类型检查 + ESLint），不构建
pnpm build:check

# 跳过测试
node script/build.js --skip-test

# 跳过类型检查
node script/build.js --skip-tsc

# 包含 Tauri 桌面应用构建
node script/build.js --tauri
```

### dev.js — 开发环境检查

```bash
# 检查环境（Node/pnpm/Rust/依赖），不启动
pnpm dev:check

# 启动完整开发环境（Tauri + Vite）
node script/dev.js

# 只启动前端（不启动 Tauri）
node script/dev.js --web
```

### package.js — 打包发布

```bash
# 清理 + 构建 + 打包为 zip
pnpm package

# 自定义输出文件名
node script/package.js --output my-release.zip

# 跳过构建直接打包
node script/package.js --skip-build
```

输出到 `../download/` 目录，自动排除 `node_modules`、`target`、`dist` 等。

### test-runner.js — 测试运行器

```bash
# 运行所有测试
node script/test-runner.js

# 监视模式
node script/test-runner.js --watch

# 生成覆盖率报告
node script/test-runner.js --coverage

# 打开 Vitest UI
node script/test-runner.js --ui

# 过滤测试文件
node script/test-runner.js format
```

## 配置

### Vitest 配置

`vitest.config.ts` 配置了：
- `environment: "jsdom"` — 模拟 DOM 环境
- `globals: true` — 全局可用 `describe`/`it`/`expect`
- `@` 别名指向 `src/`
- V8 覆盖率提供器

### 依赖

测试相关依赖（devDependencies）：
- `vitest` — 测试框架
- `@vitest/ui` — 可视化 UI
- `@vitest/coverage-v8` — 覆盖率
- `jsdom` — DOM 模拟
