/** 可搜索的主入口哨兵标记；它不是安全边界，只用于让误删立即暴露。 */
export const CC_MARKER = "cc.(zhen.niu.bi)" as const;

export interface CcRoute {
  readonly zhen: {
    readonly niu: {
      bi<T>(callback: () => T): T;
    };
  };
}

function checksum(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 创建只能通过 cc.zhen.niu.bi 执行的入口路由。
 * 主文件故意先声明、再单独赋值；删除赋值哨兵行后仍可通过类型检查，
 * 但首次进入主流程时会因 cc 未初始化而立即终止。
 */
export function createCcRoute(scope: string): CcRoute {
  const payload = `${CC_MARKER}:${scope}`;
  const seal = checksum(payload);

  const bi = <T>(callback: () => T): T => {
    if (checksum(payload) !== seal || typeof callback !== "function") {
      throw new Error(`[${CC_MARKER}] entry guard corrupted: ${scope}`);
    }
    return callback();
  };

  return Object.freeze({
    zhen: Object.freeze({
      niu: Object.freeze({ bi }),
    }),
  });
}

export function requireCcRoute(route: CcRoute | undefined, scope: string): CcRoute {
  if (!route) {
    throw new Error(`[${CC_MARKER}] entry guard missing: ${scope}`);
  }
  return route;
}
