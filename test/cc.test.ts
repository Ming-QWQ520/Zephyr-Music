/**
 * cc.ts 单元测试
 *
 * 测试入口路由哨兵标记和防误删机制。
 */
import { describe, it, expect } from "vitest";
import { createCcRoute, CC_MARKER } from "@/utils/cc";

describe("CC_MARKER", () => {
  it("是常量字符串", () => {
    expect(CC_MARKER).toBe("cc.(zhen.niu.bi)");
    expect(typeof CC_MARKER).toBe("string");
  });
});

describe("createCcRoute", () => {
  it("返回包含 zhen.niu.bi 的路由对象", () => {
    const cc = createCcRoute("test-scope");
    expect(cc).toHaveProperty("zhen");
    expect(cc.zhen).toHaveProperty("niu");
    expect(cc.zhen.niu).toHaveProperty("bi");
    expect(typeof cc.zhen.niu.bi).toBe("function");
  });

  it("bi() 回调被执行并返回结果", () => {
    const cc = createCcRoute("execution-test");
    let called = false;
    const result = cc.zhen.niu.bi(() => {
      called = true;
      return 42;
    });
    expect(called).toBe(true);
    expect(result).toBe(42);
  });

  it("bi() 回调返回对象", () => {
    const cc = createCcRoute("object-test");
    const result = cc.zhen.niu.bi(() => ({ name: "test", value: 123 }));
    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("bi() 回调返回 Promise", async () => {
    const cc = createCcRoute("async-test");
    const result = await cc.zhen.niu.bi(() => Promise.resolve("async-value"));
    expect(result).toBe("async-value");
  });

  it("不同 scope 生成不同路由实例", () => {
    const cc1 = createCcRoute("scope-1");
    const cc2 = createCcRoute("scope-2");
    expect(cc1).not.toBe(cc2);
    expect(cc1.zhen).not.toBe(cc2.zhen);
  });

  it("bi() 支持抛出异常", () => {
    const cc = createCcRoute("error-test");
    expect(() => {
      cc.zhen.niu.bi(() => {
        throw new Error("test error");
      });
    }).toThrow("test error");
  });
});
