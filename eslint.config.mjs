// ESLint 9 flat config（Vue 3 + TypeScript）
//
// 项目本身未安装 ESLint 依赖时该文件不会生效，但配置已经就绪。
// 启用方式：`pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-vue`
// 然后 `pnpm lint` / `pnpm lint:fix`。
//
// 规则取向：偏宽松（项目代码风格已稳定，不做激进重构），仅开启明显错误类规则。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default [
  // 基础 JS 推荐规则
  js.configs.recommended,
  // TypeScript 推荐规则（类型感知由 typescript-eslint 提供）
  ...tseslint.configs.recommended,
  // Vue 3 推荐规则
  ...vue.configs["flat/recommended"],

  {
    files: ["**/*.{ts,tsx,vue,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: false },
      },
    },
    rules: {
      // 与 Prettier 共存：关闭与格式相关的规则
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-console": "off",
      "no-debugger": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-irregular-whitespace": "off",

      // TypeScript：宽松
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",

      // Vue：宽松
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/no-unused-vars": "warn",
      "vue/html-self-closing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-indent": "off",
      "vue/script-indent": "off",
      "vue/attributes-order": "off",
    },
  },

  {
    // Vue SFC 用 vue-parser
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "*.config.*",
      "vite.config.ts",
    ],
  },
];
