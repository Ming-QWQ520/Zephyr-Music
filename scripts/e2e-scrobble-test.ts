/**
 * E2E 测试: 网易云双上报接口
 *
 * 运行方式: 在 Tauri 应用控制台执行，或通过 Node.js (需要 polyfill)
 *
 * 测试内容:
 *   1. EAPI scrobble (startplay + play) → POST /api/feedback/weblog
 *   2. NCBL scrobble_v1 (PLV + PLD) → POST /api/clientlog/encrypt/upload
 */

import { EapiClient } from "../src/api/netease/eapi-scrobble";
import { ncblScrobbleV1, buildNcblContext, type NcblSong, type NcblSource } from "../src/api/netease/ncbl-scrobble";

// 测试 cookie（用户提供）
const TEST_COOKIE = "MUSIC_U=00865A365122C988EACFDF622DF36C1641D1970337234C22F3A71CC8C3BA117C1B9853E3011A3395ACE60655344605164ED544C3A241CF219D22055B69FC6590B3C3682468B656AFB59D35A367B7B4E6832DA30466E3050996078665B5F16DDD5FA91406E8543AC964C3CCA733D7D988B9F958001563455F98EF0CA9069C4AAE7092DCA0FFE45F62C1B4F2BBEF1006B8E20E76ACC772A286001BA73F21886A2C737BCB2144C8C48564A3EEF45DC598254E063D9DD4A96D69D6816E94AD63D7B901BAA41B98698FB5FBBB3D24FA4B9F1B16FC51A5BC733918E74FDEF02746C33124BD253E4C93CE22D97D181F0F17BCDBF243D745E9B85CAF064B5F1C1806EEA1366B588BEAC68D67D5E817BB88F25B66A85D0CFAB76F5A753823C01958076A78B98692A1BA95584B01A5F1B1F13CB9227D0A92FE4DD48A0712F4273BD836192043B7B6B2AF19DCE04EFD71BC9924BC1AC8AA3023F81A2C732CAA68114D69E3545AE7FABFF36B8CEBCD23D24BF6E5FB42BF; __csrf=e82c30d444044715cdf9b2c77b3e2c22; NMTID=00OXe2i4RncOFhjkkDEnreS5e6TwHAAAAGfMM62EA";

// 测试参数
const TEST_SONG_ID = 1824020871;  // 晴天 - 周杰伦
const TEST_PLAY_TIME = 60;
const TEST_TOTAL_TIME = 240;

async function testEapi() {
  console.log(">>> [1/2] EAPI scrobble (startplay + play)...");
  const client = new EapiClient(TEST_COOKIE);
  const result = await client.scrobble(
    String(TEST_SONG_ID),
    String(TEST_SONG_ID),
    TEST_PLAY_TIME
  );
  console.log("EAPI result:", JSON.stringify(result, null, 2));
  return result;
}

async function testNcbl() {
  console.log(">>> [2/2] NCBL scrobble_v1 (PLV + PLD)...");
  const ctx = buildNcblContext(TEST_COOKIE);
  const song: NcblSong = {
    id: TEST_SONG_ID,
    name: "晴天",
    artist: "周杰伦",
    bitrate: 320,
    level: "exhigh",
    vip: false,
    time: TEST_TOTAL_TIME,
  };
  const source: NcblSource = {
    id: String(TEST_SONG_ID),
    type: "track",
    name: "list",
  };
  const result = await ncblScrobbleV1(ctx, song, source, TEST_PLAY_TIME);
  console.log("NCBL result:", JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  console.log("========================================");
  console.log("E2E 测试: 网易云双上报接口");
  console.log("========================================");
  console.log(`歌曲 ID: ${TEST_SONG_ID}`);
  console.log(`播放时长: ${TEST_PLAY_TIME} 秒`);
  console.log("");

  try {
    const eapiResult = await testEapi();
    console.log("");
    const ncblResult = await testNcbl();
    console.log("");
    console.log("=== 测试结果汇总 ===");
    console.log(`EAPI: code=${eapiResult.code}, msg=${eapiResult.message}`);
    console.log(`NCBL: code=${ncblResult.code}, msg=${ncblResult.message}`);
    if (eapiResult.code === 200 && ncblResult.code === 200) {
      console.log("✅ 双上报成功！");
    } else {
      console.log("⚠️ 部分成功或失败，请检查日志");
    }
  } catch (e) {
    console.error("❌ 测试异常:", e);
  }
}

main();
