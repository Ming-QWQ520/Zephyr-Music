/**
 * CloudDisk 工具函数单元测试
 *
 * 测试 clouddisk.ts 中导出的纯函数（getCloudName/getCloudArtist/getCloudCover/cloudSongToSong）。
 */
import { describe, it, expect } from "vitest";
import {
  getCloudName,
  getCloudArtist,
  getCloudCover,
  cloudSongToSong,
  type CloudDiskSong,
} from "@/api/netease";

function makeCloudSong(overrides: Partial<CloudDiskSong> = {}): CloudDiskSong {
  return {
    songId: 12345,
    songName: "默认歌曲名",
    singer: "默认歌手",
    album: "默认专辑",
    fileSize: 5000000,
    addTime: 1700000000,
    ...overrides,
  };
}

describe("getCloudName", () => {
  it("从 simpleSong.name 提取", () => {
    const song = makeCloudSong({
      songName: "顶层名称",
      simpleSong: { id: 1, name: "simpleSong名称" } as any,
    });
    expect(getCloudName(song)).toBe("simpleSong名称");
  });

  it("从 song.name 提取", () => {
    const song = makeCloudSong({
      songName: "顶层名称",
      song: { id: 1, name: "song名称" } as any,
    });
    expect(getCloudName(song)).toBe("song名称");
  });

  it("simpleSong 优先于 song", () => {
    const song = makeCloudSong({
      songName: "顶层名称",
      simpleSong: { id: 1, name: "simpleSong" } as any,
      song: { id: 2, name: "song" } as any,
    });
    expect(getCloudName(song)).toBe("simpleSong");
  });

  it("fallback 到 songName", () => {
    const song = makeCloudSong({ songName: "fallback名称" });
    expect(getCloudName(song)).toBe("fallback名称");
  });

  it("simpleSong.name 为空时 fallback", () => {
    const song = makeCloudSong({
      songName: "fallback名称",
      simpleSong: { id: 1, name: "" } as any,
    });
    expect(getCloudName(song)).toBe("fallback名称");
  });

  it("全部为空时返回未知歌曲", () => {
    const song = makeCloudSong({ songName: "", simpleSong: undefined, song: undefined });
    expect(getCloudName(song)).toBe("未知歌曲");
  });
});

describe("getCloudArtist", () => {
  it("从 simpleSong.ar 提取", () => {
    const song = makeCloudSong({
      singer: "顶层singer",
      simpleSong: {
        id: 1,
        name: "歌",
        ar: [{ id: 10, name: "歌手A" }, { id: 11, name: "歌手B" }],
      } as any,
    });
    expect(getCloudArtist(song)).toBe("歌手A, 歌手B");
  });

  it("从 simpleSong.artists 提取", () => {
    const song = makeCloudSong({
      simpleSong: {
        id: 1,
        artists: [{ id: 10, name: "艺术家A" }],
      } as any,
    });
    expect(getCloudArtist(song)).toBe("艺术家A");
  });

  it("从顶层 ar 提取", () => {
    const song = makeCloudSong({
      singer: "顶层singer",
      ar: [{ id: 10, name: "顶层歌手A" }],
    });
    expect(getCloudArtist(song)).toBe("顶层歌手A");
  });

  it("从顶层 artists 提取", () => {
    const song = makeCloudSong({
      artists: [{ id: 10, name: "顶层艺术家A" }],
    });
    expect(getCloudArtist(song)).toBe("顶层艺术家A");
  });

  it("fallback 到 singer", () => {
    const song = makeCloudSong({ singer: "singer字段" });
    expect(getCloudArtist(song)).toBe("singer字段");
  });

  it("全部为空时返回未知艺术家", () => {
    const song = makeCloudSong({
      singer: "",
      ar: [],
      artists: [],
      simpleSong: undefined,
    });
    expect(getCloudArtist(song)).toBe("未知艺术家");
  });

  it("过滤空名", () => {
    const song = makeCloudSong({
      ar: [{ id: 10, name: "有效" }, { id: 11, name: "" }, { id: 12, name: "有效2" }],
    });
    expect(getCloudArtist(song)).toBe("有效, 有效2");
  });
});

describe("getCloudCover", () => {
  it("从 simpleSong.al.picUrl 提取", () => {
    const song = makeCloudSong({
      simpleSong: {
        id: 1,
        al: { id: 100, name: "专辑", picUrl: "https://example.com/al.jpg" },
      } as any,
    });
    expect(getCloudCover(song)).toBe("https://example.com/al.jpg");
  });

  it("从 simpleSong.picUrl 提取", () => {
    const song = makeCloudSong({
      simpleSong: {
        id: 1,
        picUrl: "https://example.com/simple.jpg",
      } as any,
    });
    expect(getCloudCover(song)).toBe("https://example.com/simple.jpg");
  });

  it("从顶层 al.picUrl 提取", () => {
    const song = makeCloudSong({
      al: { id: 100, name: "专辑", picUrl: "https://example.com/top-al.jpg" },
    });
    expect(getCloudCover(song)).toBe("https://example.com/top-al.jpg");
  });

  it("从顶层 picUrl 提取", () => {
    const song = makeCloudSong({
      picUrl: "https://example.com/top.jpg",
    });
    expect(getCloudCover(song)).toBe("https://example.com/top.jpg");
  });

  it("全部为空时返回空字符串", () => {
    const song = makeCloudSong({
      picUrl: undefined,
      al: undefined,
      simpleSong: undefined,
    });
    expect(getCloudCover(song)).toBe("");
  });
});

describe("cloudSongToSong", () => {
  it("有 simpleSong 时优先用完整歌曲对象转换", () => {
    const song = makeCloudSong({
      songId: 999,
      simpleSong: {
        id: 888,
        name: "测试歌曲",
        ar: [{ id: 1, name: "测试歌手" }],
        al: { id: 10, name: "测试专辑", picUrl: "https://example.com/cover.jpg" },
        dt: 180000,
      } as any,
    });
    const result = cloudSongToSong(song);
    expect(result.neteaseId).toBe(999); // 用云盘 songId
    expect(result.name).toBe("测试歌曲");
    expect(result.artist).toBe("测试歌手");
    expect(result.pic).toBe("https://example.com/cover.jpg");
    expect(result.duration).toBe(180); // 180000ms → 180s
  });

  it("无 simpleSong 时 fallback 手动构造", () => {
    const song = makeCloudSong({
      songId: 777,
      songName: "fallback歌曲",
      singer: "fallback歌手",
      picUrl: "https://example.com/fallback.jpg",
      dt: 240000,
    });
    const result = cloudSongToSong(song);
    expect(result.neteaseId).toBe(777);
    expect(result.name).toBe("fallback歌曲");
    expect(result.artist).toBe("fallback歌手");
    expect(result.pic).toBe("https://example.com/fallback.jpg");
    expect(result.duration).toBe(240);
    expect(result.source).toBe("netease");
    expect(result.id).toBe("cloud_777");
  });

  it("duration 为 0 时正常处理", () => {
    const song = makeCloudSong({
      songId: 555,
      songName: "零时长",
      singer: "歌手",
    });
    const result = cloudSongToSong(song);
    expect(result.duration).toBe(0);
  });

  it("url 和 lrc 默认为空字符串", () => {
    const song = makeCloudSong({
      songId: 444,
      songName: "测试",
      singer: "歌手",
    });
    const result = cloudSongToSong(song);
    expect(result.url).toBe("");
    expect(result.lrc).toBe("");
  });
});
