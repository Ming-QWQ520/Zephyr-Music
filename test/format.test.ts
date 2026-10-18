/**
 * format.ts 单元测试
 *
 * 测试时间格式化、数字格式化、日志截断等纯函数。
 */
import { describe, it, expect } from "vitest";
import { formatTime, formatCount, formatListenTime, truncateForLog } from "@/utils/format";

describe("formatTime", () => {
  it("格式化 0 秒", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("格式化负数", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(-100)).toBe("0:00");
  });

  it("格式化 NaN/Infinity", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-Infinity)).toBe("0:00");
  });

  it("格式化秒数 < 60", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(10)).toBe("0:10");
    expect(formatTime(59)).toBe("0:59");
  });

  it("格式化秒数 >= 60", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(119)).toBe("1:59");
    expect(formatTime(120)).toBe("2:00");
    expect(formatTime(599)).toBe("9:59");
    expect(formatTime(600)).toBe("10:00");
  });

  it("格式化大秒数", () => {
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(3661)).toBe("61:01");
    expect(formatTime(7384)).toBe("123:04");
  });

  it("处理浮点数（向下取整）", () => {
    expect(formatTime(59.9)).toBe("0:59");
    expect(formatTime(60.9)).toBe("1:00");
    expect(formatTime(90.5)).toBe("1:30");
  });
});

describe("formatCount", () => {
  it("格式化小数字", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(9999)).toBe("9999");
  });

  it("格式化万级数字", () => {
    expect(formatCount(10000)).toBe("1.0万");
    expect(formatCount(15000)).toBe("1.5万");
    expect(formatCount(99999)).toBe("10.0万");
    expect(formatCount(99999999)).toBe("10000.0万");
  });

  it("格式化亿级数字", () => {
    expect(formatCount(100000000)).toBe("1.0亿");
    expect(formatCount(150000000)).toBe("1.5亿");
    expect(formatCount(1000000000)).toBe("10.0亿");
  });

  it("边界值", () => {
    expect(formatCount(9999)).toBe("9999");
    expect(formatCount(10000)).toBe("1.0万");
    expect(formatCount(99999999)).toBe("10000.0万");
    expect(formatCount(100000000)).toBe("1.0亿");
  });
});

describe("formatListenTime", () => {
  it("处理 0 和负数", () => {
    expect(formatListenTime(0)).toBe("0分钟");
    expect(formatListenTime(-1)).toBe("0分钟");
    expect(formatListenTime(-100)).toBe("0分钟");
  });

  it("格式化分钟级", () => {
    expect(formatListenTime(60)).toBe("1分钟");
    expect(formatListenTime(120)).toBe("2分钟");
    expect(formatListenTime(600)).toBe("10分钟");
    expect(formatListenTime(3599)).toBe("59分钟");
  });

  it("格式化小时级", () => {
    expect(formatListenTime(3600)).toBe("1小时0分钟");
    expect(formatListenTime(3660)).toBe("1小时1分钟");
    expect(formatListenTime(7200)).toBe("2小时0分钟");
    expect(formatListenTime(7384)).toBe("2小时3分钟");
  });

  it("格式化大数值", () => {
    expect(formatListenTime(36000)).toBe("10小时0分钟");
    expect(formatListenTime(86400)).toBe("24小时0分钟");
  });
});

describe("truncateForLog", () => {
  it("短字符串不截断", () => {
    expect(truncateForLog("hello")).toBe("hello");
    expect(truncateForLog("")).toBe("");
  });

  it("长字符串截断到指定长度", () => {
    const long = "a".repeat(600);
    const result = truncateForLog(long, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("...(truncated, total 600 chars)");
  });

  it("对象先 JSON.stringify 再截断", () => {
    const obj = { name: "test", value: 123 };
    const result = truncateForLog(obj);
    expect(result).toContain('"name":"test"');
    expect(result).toContain('"value":123');
  });

  it("使用默认 maxLen=500", () => {
    const long = "x".repeat(600);
    const result = truncateForLog(long);
    expect(result).toContain("...(truncated, total 600 chars)");
    expect(result.startsWith("x".repeat(500))).toBe(true);
  });

  it("处理循环引用对象", () => {
    const obj: any = { name: "circular" };
    obj.self = obj;
    // 不应抛出异常，返回 String(obj)
    const result = truncateForLog(obj);
    expect(typeof result).toBe("string");
  });

  it("处理 null/undefined", () => {
    expect(truncateForLog(null)).toBe("null");
    expect(truncateForLog(undefined)).toBe("undefined");
  });
});
