use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
use aes::Aes128;
use flate2::{write::GzEncoder, Compression};
use num_bigint::BigUint;
use rand::RngCore;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, ORIGIN, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::time::Duration;

const MUSIC_DOMAIN: &str = "https://music.163.com";
const EAPI_APP_VERSION: &str = "3.1.35.205293";
const EAPI_KEY: &[u8; 16] = b"e82ckenh8dichen8";
const EAPI_SALT: &str = "36cd479b6b5";
const CLIENT_LOG_HOST: &str = "https://clientlog3.music.163.com";
const CLIENT_LOG_UPLOAD: &str = "/api/clientlog/encrypt/upload?multiupload=true";
const NCBL_VERSION: u32 = 3;
const NCBL_HEADER_LEN: usize = 70;
const NCBL_META_BLOCK_TYPE: u16 = 0x4343;
const NCBL_MAX_FRAME: usize = 0x8000;
const NCBL_FIELD_SEP: char = '\x01';
const RSA_N_HEX: &str = "fd90bd466ff9bc8a3fec2fbcf263b90d5c564879fa5d7aab89b31c1d5cb4139d";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackReportRequest {
    pub cookie: String,
    pub song_id: u64,
    pub source_id: Option<String>,
    pub play_time: u32,
    pub total_time: Option<u32>,
    pub bitrate: Option<u32>,
    pub level: Option<String>,
    pub mode: Option<String>,
    pub dry_run: Option<bool>,
    pub is_auto_next: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackReportResponse {
    pub code: u16,
    pub message: String,
    pub song_id: u64,
    pub source_id: String,
    pub play_time: u32,
    pub mode: String,
    pub eapi: Option<Value>,
    pub ncbl: Option<Value>,
}

#[tauri::command]
pub async fn netease_report_playback(
    request: PlaybackReportRequest,
) -> Result<PlaybackReportResponse, String> {
    report_playback(request)
        .await
        .map_err(|err| err.to_string())
}

async fn report_playback(
    request: PlaybackReportRequest,
) -> Result<PlaybackReportResponse, Box<dyn std::error::Error + Send + Sync>> {
    let mode = request
        .mode
        .clone()
        .unwrap_or_else(|| "both".to_string())
        .to_lowercase();
    if mode != "eapi" && mode != "ncbl" && mode != "both" {
        return Err("mode must be eapi, ncbl, or both".into());
    }
    let source_id = request
        .source_id
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| request.song_id.to_string());
    let play_time = request.play_time.max(1);
    let total_time = request.total_time.unwrap_or(play_time).max(play_time);
    let dry_run = request.dry_run.unwrap_or(false);

    if request.cookie.trim().is_empty() && !dry_run {
        return Ok(PlaybackReportResponse {
            code: 401,
            message: "missing NetEase cookie".to_string(),
            song_id: request.song_id,
            source_id,
            play_time,
            mode,
            eapi: None,
            ncbl: None,
        });
    }

    let mut eapi_result = None;
    let mut ncbl_result = None;

    if mode == "eapi" || mode == "both" {
        if dry_run {
            eapi_result = Some(json!({
                "url": "https://music.163.com/eapi/feedback/weblog",
                "events": ["startplay", "play"],
                "songId": request.song_id,
                "sourceId": source_id,
                "playTime": play_time,
            }));
        } else {
            let client = EapiClient::new(&request.cookie);
            eapi_result = Some(
                client
                    .scrobble(&request.song_id.to_string(), &source_id, play_time)
                    .await?,
            );
        }
    }

    if mode == "ncbl" || mode == "both" {
        if dry_run {
            ncbl_result = Some(json!({
                "url": "https://clientlog3.music.163.com/api/clientlog/encrypt/upload?multiupload=true",
                "events": ["_plv", "_pld"],
                "songId": request.song_id,
                "sourceId": source_id,
                "playTime": play_time,
                "totalTime": total_time,
            }));
        } else {
            let ctx = NcblContext::from_cookie(&request.cookie);
            let song = NcblSong {
                id: request.song_id,
                bitrate: request.bitrate.unwrap_or(320),
                level: request.level.unwrap_or_else(|| "exhigh".to_string()),
                total_time,
            };
            let source = NcblSource {
                id: source_id.clone(),
                source_type: "track".to_string(),
                name: "list".to_string(),
            };
            ncbl_result = Some(ncbl_scrobble_v1(&ctx, &song, &source, play_time, request.is_auto_next.unwrap_or(false)).await?);
        }
    }

    Ok(PlaybackReportResponse {
        code: 200,
        message: "netease playback report finished".to_string(),
        song_id: request.song_id,
        source_id,
        play_time,
        mode,
        eapi: eapi_result,
        ncbl: ncbl_result,
    })
}

struct EapiClient {
    http: reqwest::Client,
    device_id: String,
    cookies: BTreeMap<String, String>,
}

impl EapiClient {
    fn new(raw_cookie: &str) -> Self {
        let mut cookies = BTreeMap::from([
            ("os".to_string(), "pc".to_string()),
            ("appver".to_string(), EAPI_APP_VERSION.to_string()),
        ]);
        for (key, value) in parse_cookie_header(raw_cookie) {
            cookies.insert(key, value);
        }
        // api-enhanced 的 scrobble 模块会强制注入 os=osx；该值会影响最近播放记录写入。
        cookies.insert("os".to_string(), "osx".to_string());
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .expect("reqwest client"),
            device_id: random_hex(16),
            cookies,
        }
    }

    async fn scrobble(
        &self,
        song_id: &str,
        source_id: &str,
        play_time: u32,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let startplay_logs = json!([{
            "action": "startplay",
            "json": {
                "id": song_id,
                "type": "song",
                "mainsite": "1",
                "mainsiteWeb": "1",
                "content": format!("id={source_id}")
            }
        }]);
        let startplay = self.feedback_weblog(startplay_logs).await?;

        let play_logs = json!([{
            "action": "play",
            "json": {
                "download": 0,
                "end": "playend",
                "id": song_id,
                "sourceId": source_id,
                "time": play_time,
                "type": "song",
                "wifi": 0,
                "source": "list",
                "mainsite": "1",
                "mainsiteWeb": "1",
                "content": format!("id={source_id}")
            }
        }]);
        let play = self.feedback_weblog(play_logs).await?;

        Ok(json!({
            "code": 200,
            "message": "eapi scrobble reported",
            "details": { "startplay": startplay, "play": play }
        }))
    }

    async fn feedback_weblog(
        &self,
        logs: Value,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.eapi_post(
            "/api/feedback/weblog",
            json!({ "logs": compact_json(&logs) }),
        )
        .await
    }

    async fn eapi_post(
        &self,
        path: &str,
        payload: Value,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let mut body_payload = payload.as_object().cloned().unwrap_or_default();
        body_payload.insert(
            "header".to_string(),
            json!(compact_json(&json!({
                "os": "pc",
                "appver": EAPI_APP_VERSION,
                "deviceId": self.device_id,
                "requestId": "0",
                "osver": "Microsoft-Windows-10"
            }))),
        );
        let encrypted = eapi_encrypt(path, &Value::Object(body_payload));

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_str(&format!("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) NeteaseMusicDesktop/{EAPI_APP_VERSION} Safari/537.36"))?);
        headers.insert(ORIGIN, HeaderValue::from_static(MUSIC_DOMAIN));
        headers.insert(REFERER, HeaderValue::from_static("https://music.163.com/"));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(COOKIE, HeaderValue::from_str(&self.cookie_header())?);

        let url = api_to_eapi_url(path);
        let resp = self
            .http
            .post(url)
            .headers(headers)
            .form(&[("params", encrypted)])
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        let mut value: Value =
            serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
        if let Some(obj) = value.as_object_mut() {
            obj.insert("http_status".to_string(), json!(status));
        }
        Ok(value)
    }

    fn cookie_header(&self) -> String {
        self.cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

fn eapi_encrypt(path: &str, params: &Value) -> String {
    let payload = compact_json(params);
    let digest = format!(
        "{:x}",
        md5::compute(format!("nobody{path}use{payload}md5forencrypt"))
    );
    let raw = format!("{path}-{EAPI_SALT}-{payload}-{EAPI_SALT}-{digest}");
    let mut data = pkcs7_pad(raw.as_bytes(), 16);
    let cipher = Aes128::new(GenericArray::from_slice(EAPI_KEY));
    for chunk in data.chunks_mut(16) {
        cipher.encrypt_block(GenericArray::from_mut_slice(chunk));
    }
    hex_upper(&data)
}

fn pkcs7_pad(data: &[u8], block_size: usize) -> Vec<u8> {
    let padding = block_size - (data.len() % block_size);
    let mut out = Vec::from(data);
    out.extend(std::iter::repeat(padding as u8).take(padding));
    out
}

fn api_to_eapi_url(path: &str) -> String {
    let clean = path
        .split('?')
        .next()
        .unwrap_or(path)
        .trim_start_matches("/api/");
    format!("{MUSIC_DOMAIN}/eapi/{clean}")
}

#[derive(Clone)]
struct NcblContext {
    app_version: String,
    app_version_code: String,
    channel: String,
    nsm: String,
    cid: String,
    device_id: String,
    ti: String,
    sign: String,
    system_type: String,
    system_version: String,
    nnid: String,
    nuid: String,
    csrf: String,
    token: String,
    session_id: String,
    vip_type: String,
}

impl NcblContext {
    fn from_cookie(raw_cookie: &str) -> Self {
        let cookies = parse_cookie_header(raw_cookie);
        Self {
            app_version: "3.1.35".to_string(),
            app_version_code: "205293".to_string(),
            channel: cookie_or(&cookies, "channel", "netease"),
            nsm: cookie_or(&cookies, "WEVNSM", "1.0.0"),
            cid: cookie_or(&cookies, "WNMCID", "abc123.1700000000.01.0"),
            device_id: cookies
                .get("deviceId")
                .or_else(|| cookies.get("sDeviceId"))
                .cloned()
                .unwrap_or_default(),
            ti: cookies.get("NMTID").cloned().unwrap_or_default(),
            sign: cookies.get("clientSign").cloned().unwrap_or_default(),
            system_type: "pc".to_string(),
            system_version: cookie_or(
                &cookies,
                "osver",
                "Microsoft-Windows-10-Professional-build-19045-64bit",
            ),
            nnid: cookie_or(&cookies, "_ntes_nnid", ","),
            nuid: cookies.get("_ntes_nuid").cloned().unwrap_or_default(),
            csrf: cookies.get("__csrf").cloned().unwrap_or_default(),
            token: cookies.get("MUSIC_U").cloned().unwrap_or_default(),
            session_id: cookies.get("JSESSIONID-WYYY").cloned().unwrap_or_default(),
            vip_type: cookies.get("vipType").cloned().unwrap_or_default(),
        }
    }
}

struct NcblSong {
    id: u64,
    bitrate: u32,
    level: String,
    total_time: u32,
}

struct NcblSource {
    id: String,
    source_type: String,
    name: String,
}

async fn ncbl_scrobble_v1(
    ctx: &NcblContext,
    song: &NcblSong,
    source: &NcblSource,
    play_time: u32,
    is_auto_next: bool,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    if ctx.token.is_empty() {
        return Ok(json!({ "code": 401, "message": "missing MUSIC_U token" }));
    }
    let played = song.total_time.min(play_time.max(1));
    let meta = build_ncbl_meta_json(ctx);
    let cookie = build_ncbl_cookie(ctx);

    // PLV / PLD 时间戳：均使用当前时间（对齐 api-enhanced 参考实现）
    // 网易云通过 PLD 的 time/realtime 字段值（= played 秒数）判定听歌时长，
    // 不依赖 PLV 与 PLD 之间的真实时间差。played >= 30 由前端 accumulatedTime 保证。
    // 旧实现 sleep 30 秒 + pld_ts = plv_ts + played 是误判，反而可能触发风控，
    // 且阻塞过运行时。这里改为与 api-enhanced 一致：同时间戳、连续上传。
    let ts = chrono::Local::now().timestamp();

    let plv = build_plv(ctx, song, source);
    let plv_body = build_ncbl_records(&[(ts, "_plv", plv)]);
    let plv_result = ncbl_upload(ctx, &meta, &plv_body, &cookie).await?;
    if !plv_result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(json!({ "code": 500, "message": "PLV report failed", "plv": plv_result }));
    }

    // 短暂等待 2 秒模拟真实客户端的 PLV→PLD 间隔（避免完全瞬时触发风控），
    // 但不再等待 30 秒——网易云判定时长靠 PLD 的 time 字段，不靠上传间隔。
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let pld = build_pld(ctx, song, source, played, is_auto_next);
    let pld_body = build_ncbl_records(&[(ts, "_pld", pld)]);
    let pld_result = ncbl_upload(ctx, &meta, &pld_body, &cookie).await?;
    if !pld_result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(
            json!({ "code": 500, "message": "PLD report failed", "plv": plv_result, "pld": pld_result }),
        );
    }

    Ok(
        json!({ "code": 200, "message": "ncbl scrobble_v1 reported", "plv": plv_result, "pld": pld_result }),
    )
}

fn build_plv(ctx: &NcblContext, song: &NcblSong, source: &NcblSource) -> Value {
    let now = chrono::Local::now().timestamp_millis();
    let add_refer = format!(
        "[F:63][{now}#933#{}#{}#c9156c3][e][2][23][cell_pc_songlist_song:2|page_pc_songlist_songflow|page_mine_like_music][{}:song:x:x|:::|{}:list::]",
        ctx.app_version, ctx.app_version_code, song.id, source.id
    );
    json!({
        "mode": "circulation",
        "download": 0,
        "alg": "",
        "status": "front",
        "id": song.id.to_string(),
        "bitrate": song.bitrate,
        "type": "song",
        "is_listentogether": 0,
        "source": source.name,
        "is_heart": 0,
        "resource_ratio": "",
        "resource_time": song.total_time,
        "musiceffect_id": "",
        "app_mode": 2,
        "bitrate_level": song.level,
        "_addrefer": add_refer,
        "_multirefers": [
            "[F:26][s][18][_ai]",
            "[F:26][s][12][_ai]",
            format!("[F:63][{now}#933#{}#{}#c9156c3][e][2][8][cell_pc_main_tab_entrance:6|page_pc_main_tab][我喜欢的音乐:spm::|:::]", ctx.app_version, ctx.app_version_code),
            "[F:26][s][5][_ai]",
            "[F:26][s][0][_ai]"
        ],
        "vipType": ctx.vip_type,
        "fee": 1,
        "file": 4,
        "rightSource": 0,
        "sourceId": source.id,
        "sourcetype": source.source_type,
        "libra_abt": "",
        "channel": ctx.channel,
        "curStartChannel": ""
    })
}

fn build_pld(ctx: &NcblContext, song: &NcblSong, source: &NcblSource, played: u32, _is_auto_next: bool) -> Value {
    let now = chrono::Local::now().timestamp_millis();
    let add_refer = format!(
        "[F:63][{now}#616#{}#{}#c9156c3][e][2][92][btn_pc_cover_play|cell_pc_songlist_song:6|page_pc_songlist_songflow|page_mine_like_music][:::|{}:song:x:x|:::|{}:list::]",
        ctx.app_version, ctx.app_version_code, song.id, source.id
    );
    json!({
        "mode": "circulation",
        "download": 0,
        "alg": "",
        "status": "front",
        "id": song.id.to_string(),
        "time": played,
        "type": "song",
        "is_listentogether": 0,
        "source": source.name,
        "is_heart": 0,
        "realtime": played,
        "resource_ratio": "",
        "resource_time": song.total_time,
        "musiceffect_id": "1001",
        "app_mode": 1,
        "lyriceffect": "default",
        "displayMode": "classic",
        "bitrate": song.bitrate,
        "bitrate_level": song.level,
        "_addrefer": add_refer,
        "_multirefers": [
            "[F:26][s][87][_ai]",
            "[F:26][s][81][_ai]",
            "[F:26][s][75][_ai]",
            "[F:26][s][69][_ai]",
            "[F:26][s][63][_ai]"
        ],
        "vipType": ctx.vip_type,
        "fee": 8,
        "file": 4,
        "rightSource": 0,
        "sourceId": source.id,
        "sourcetype": source.source_type,
        // end 字段固定 "interrupt"（对齐 api-enhanced 参考实现）。
        // 旧实现根据 is_auto_next 切换 playend/interrupt，但 playend 可能触发网易云
        // 更严格的 time≈resource_time 校验；interrupt 更宽松，api-enhanced 生产验证可行。
        "end": "interrupt",
        "libra_abt": "",
        "channel": ctx.channel,
        "curStartChannel": ""
    })
}

async fn ncbl_upload(
    ctx: &NcblContext,
    meta_json: &[u8],
    body: &[u8],
    cookie: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let payload = ncbl_encrypt(meta_json, body)?;
    let file_name = random_ncbl_file_name();
    let part = reqwest::multipart::Part::bytes(payload.clone()).file_name(file_name.clone());
    let form = reqwest::multipart::Form::new().part("file", part);
    let appver = format!("{}.{}", ctx.app_version, ctx.app_version_code);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let resp = client
        .post(format!("{CLIENT_LOG_HOST}{CLIENT_LOG_UPLOAD}"))
        .header(REFERER, "https://music.163.com/di")
        .header(USER_AGENT, format!("Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/{appver}"))
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.8")
        .header(COOKIE, cookie)
        .multipart(form)
        .send()
        .await?;
    let status = resp.status().as_u16();
    let text = resp.text().await?;
    let mut resp_body: Value =
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
    if let Some(obj) = resp_body.as_object_mut() {
        obj.insert("http_status".to_string(), json!(status));
    }

    let success = resp_body
        .get("code")
        .and_then(Value::as_i64)
        .map(|code| code == 200)
        .unwrap_or(false)
        && resp_body
            .pointer("/data/successfiles")
            .and_then(Value::as_array)
            .map(|files| files.iter().any(|item| item.as_str() == Some(&file_name)))
            .unwrap_or(false);

    Ok(
        json!({ "success": success, "fileName": file_name, "payloadLen": payload.len(), "respBody": resp_body }),
    )
}

fn build_ncbl_meta_json(ctx: &NcblContext) -> Vec<u8> {
    compact_json(&json!({
        "JSESSIONID-WYYY": ctx.session_id,
        "MUSIC_U": ctx.token,
        "NMTID": ctx.ti,
        "WEVNSM": ctx.nsm,
        "WNMCID": ctx.cid,
        "__csrf": ctx.csrf,
        "_iuqxldmzr_": "33",
        "_ntes_nnid": ctx.nnid,
        "_ntes_nuid": ctx.nuid,
        "appver": format!("{}.{}", ctx.app_version, ctx.app_version_code),
        "channel": ctx.channel,
        "clientSign": ctx.sign,
        "deviceId": ctx.device_id,
        "mode": "",
        "ntes_kaola_ad": "1",
        "os": ctx.system_type,
        "osver": ctx.system_version
    }))
    .into_bytes()
}

fn build_ncbl_cookie(ctx: &NcblContext) -> String {
    format!(
        "JSESSIONID-WYYY={}; MUSIC_U={}; NMTID={}; WEVNSM={}; WNMCID={}; __csrf={}; __remember_me=true; _iuqxldmzr_=33; _ntes_nnid={}; _ntes_nuid={}; appver={}.{}; channel={}; clientSign={}; deviceId={}; ntes_kaola_ad=1; os={}; osver={}",
        ctx.session_id, ctx.token, ctx.ti, ctx.nsm, ctx.cid, ctx.csrf, ctx.nnid, ctx.nuid,
        ctx.app_version, ctx.app_version_code, ctx.channel, ctx.sign, ctx.device_id,
        ctx.system_type, ctx.system_version
    )
}

fn build_ncbl_records(records: &[(i64, &str, Value)]) -> Vec<u8> {
    let mut out = String::new();
    for (time, action, data) in records {
        out.push_str(&format!(
            "{time}{NCBL_FIELD_SEP}{action}{NCBL_FIELD_SEP}{}",
            compact_json(data)
        ));
    }
    out.into_bytes()
}

fn ncbl_encrypt(
    meta_json: &[u8],
    body: &[u8],
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mut rng = rand::thread_rng();
    let mut key_a = [0u8; 32];
    rng.fill_bytes(&mut key_a);
    if key_a[0] >= 0xa3 {
        key_a[0] = 0xa2;
    }
    let key_b = rsa_wrap(&key_a)?;

    let mut uuid = [0u8; 16];
    rng.fill_bytes(&mut uuid);
    uuid[6] = (uuid[6] & 0x0f) | 0x40;
    uuid[8] = (uuid[8] & 0x3f) | 0x80;
    let nonce = &uuid[0..12];
    let counter = u32::from_le_bytes(uuid[12..16].try_into().unwrap()) >> 2;
    let base_seq = rng.next_u32() as u16;

    let meta_cipher = chacha20(&key_b, counter, nonce, meta_json);
    let mut meta_block = Vec::with_capacity(4 + meta_cipher.len());
    meta_block.extend_from_slice(&NCBL_META_BLOCK_TYPE.to_le_bytes());
    meta_block.extend_from_slice(&(meta_cipher.len() as u16).to_le_bytes());
    meta_block.extend_from_slice(&meta_cipher);

    let compressed = gzip_compress(body)?;
    let mut frames = Vec::new();
    let mut seq = base_seq;
    for slice in compressed.chunks(NCBL_MAX_FRAME) {
        let cipher_slice = chacha20(&key_a, counter, nonce, slice);
        frames.extend_from_slice(&(cipher_slice.len() as u16).to_le_bytes());
        frames.extend_from_slice(&(seq as u32).to_le_bytes());
        frames.extend_from_slice(&cipher_slice);
        seq = seq.wrapping_add(1);
    }
    let frame_count = seq.wrapping_sub(base_seq).max(1);
    let header_len = NCBL_HEADER_LEN + meta_block.len();

    let mut header = vec![0u8; NCBL_HEADER_LEN];
    header[0..4].copy_from_slice(b"NCBL");
    header[4..8].copy_from_slice(&NCBL_VERSION.to_le_bytes());
    header[8..10].copy_from_slice(&(header_len as u16).to_le_bytes());
    header[10..26].copy_from_slice(&uuid);
    header[26..58].copy_from_slice(&key_b);
    header[58..62].copy_from_slice(&(base_seq as u32).to_le_bytes());
    header[62..66].copy_from_slice(
        &(base_seq.wrapping_add(frame_count).wrapping_sub(1) as u32).to_le_bytes(),
    );
    header[66..70].copy_from_slice(&(frames.len() as u32).to_le_bytes());

    header.extend_from_slice(&meta_block);
    header.extend_from_slice(&frames);
    Ok(header)
}

fn rsa_wrap(key_a: &[u8; 32]) -> Result<[u8; 32], Box<dyn std::error::Error + Send + Sync>> {
    let n = BigUint::parse_bytes(RSA_N_HEX.as_bytes(), 16).ok_or("invalid rsa modulus")?;
    let e = BigUint::from(65537u32);
    let m = BigUint::from_bytes_be(key_a);
    let c = m.modpow(&e, &n);
    let bytes = c.to_bytes_be();
    let mut out = [0u8; 32];
    let start = 32usize.saturating_sub(bytes.len());
    out[start..].copy_from_slice(&bytes[bytes.len().saturating_sub(32)..]);
    Ok(out)
}

fn gzip_compress(data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data)?;
    Ok(encoder.finish()?)
}

fn chacha20(key: &[u8], counter: u32, nonce: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; data.len()];
    for (block_index, chunk) in data.chunks(64).enumerate() {
        let key_stream = chacha_block(key, counter.wrapping_add(block_index as u32), nonce);
        for (i, byte) in chunk.iter().enumerate() {
            out[block_index * 64 + i] = byte ^ key_stream[i];
        }
    }
    out
}

fn chacha_block(key: &[u8], counter: u32, nonce: &[u8]) -> [u8; 64] {
    let constants = [0x61707865u32, 0x3320646e, 0x79622d32, 0x6b206574];
    let mut state = [0u32; 16];
    state[0..4].copy_from_slice(&constants);
    for i in 0..8 {
        state[4 + i] = u32::from_le_bytes(key[i * 4..i * 4 + 4].try_into().unwrap());
    }
    state[12] = counter;
    state[13] = u32::from_le_bytes(nonce[0..4].try_into().unwrap());
    state[14] = u32::from_le_bytes(nonce[4..8].try_into().unwrap());
    state[15] = u32::from_le_bytes(nonce[8..12].try_into().unwrap());

    let mut work = state;
    for _ in 0..10 {
        quarter_round(&mut work, 0, 4, 8, 12);
        quarter_round(&mut work, 1, 5, 9, 13);
        quarter_round(&mut work, 2, 6, 10, 14);
        quarter_round(&mut work, 3, 7, 11, 15);
        quarter_round(&mut work, 0, 5, 10, 15);
        quarter_round(&mut work, 1, 6, 11, 12);
        quarter_round(&mut work, 2, 7, 8, 13);
        quarter_round(&mut work, 3, 4, 9, 14);
    }

    let mut out = [0u8; 64];
    for i in 0..16 {
        out[i * 4..i * 4 + 4].copy_from_slice(&work[i].wrapping_add(state[i]).to_le_bytes());
    }
    out
}

fn quarter_round(s: &mut [u32; 16], a: usize, b: usize, c: usize, d: usize) {
    s[a] = s[a].wrapping_add(s[b]);
    s[d] ^= s[a];
    s[d] = s[d].rotate_left(16);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] ^= s[c];
    s[b] = s[b].rotate_left(12);
    s[a] = s[a].wrapping_add(s[b]);
    s[d] ^= s[a];
    s[d] = s[d].rotate_left(8);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] ^= s[c];
    s[b] = s[b].rotate_left(7);
}

fn parse_cookie_header(raw: &str) -> BTreeMap<String, String> {
    #[derive(Deserialize)]
    struct Entry {
        name: String,
        value: String,
    }
    let trimmed = raw.trim();
    if trimmed.starts_with('[') {
        if let Ok(entries) = serde_json::from_str::<Vec<Entry>>(trimmed) {
            return entries
                .into_iter()
                .filter(|e| !e.name.is_empty())
                .map(|e| (e.name, e.value))
                .collect();
        }
    }
    trimmed
        .split(';')
        .filter_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            if key.is_empty() {
                None
            } else {
                Some((key.to_string(), value.to_string()))
            }
        })
        .collect()
}

fn cookie_or(cookies: &BTreeMap<String, String>, key: &str, default_value: &str) -> String {
    cookies
        .get(key)
        .cloned()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default_value.to_string())
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn random_hex(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex_lower(&bytes)
}

fn random_ncbl_file_name() -> String {
    let mut bytes = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut bytes);
    let part_a = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let part_b = u16::from_be_bytes([bytes[4], bytes[5]]);
    format!("op_{part_a}_0_{part_b}")
}

fn hex_upper(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_lower(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_cookie_header() {
        let parsed = parse_cookie_header("MUSIC_U=abc; __csrf=def; NMTID=ghi");
        assert_eq!(parsed.get("MUSIC_U").map(String::as_str), Some("abc"));
        assert_eq!(parsed.get("__csrf").map(String::as_str), Some("def"));
        assert_eq!(parsed.get("NMTID").map(String::as_str), Some("ghi"));
    }

    #[test]
    fn ncbl_packet_has_expected_header() {
        let packet = ncbl_encrypt(br#"{"MUSIC_U":"token"}"#, b"1\x01_pld\x01{}").expect("packet");
        assert_eq!(&packet[0..4], b"NCBL");
        assert_eq!(
            u32::from_le_bytes(packet[4..8].try_into().unwrap()),
            NCBL_VERSION
        );
        assert!(packet.len() > NCBL_HEADER_LEN);
    }

    #[test]
    fn eapi_encrypt_is_hex_and_block_aligned() {
        let encrypted = eapi_encrypt("/api/feedback/weblog", &json!({"logs":"[]"}));
        assert!(!encrypted.is_empty());
        assert!(encrypted
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
        assert_eq!(encrypted.len() % 32, 0);
    }

    #[test]
    fn dry_run_command_previews_both_report_paths_without_cookie() {
        let response = tauri::async_runtime::block_on(report_playback(PlaybackReportRequest {
            cookie: String::new(),
            song_id: 1_824_020_871,
            source_id: Some("7276012468".to_string()),
            play_time: 60,
            total_time: Some(245),
            bitrate: Some(320),
            level: Some("exhigh".to_string()),
            mode: Some("both".to_string()),
            dry_run: Some(true),
        }))
        .expect("dry-run response");

        assert_eq!(response.code, 200);
        assert_eq!(response.mode, "both");
        assert_eq!(response.play_time, 60);
        assert!(response
            .eapi
            .as_ref()
            .and_then(|value| value.get("events"))
            .is_some());
        assert!(response
            .ncbl
            .as_ref()
            .and_then(|value| value.get("events"))
            .is_some());
    }

    #[test]
    fn real_account_e2e_reports_when_cookie_env_is_set() {
        let Ok(cookie) = std::env::var("NETEASE_E2E_COOKIE") else {
            eprintln!("skipped: NETEASE_E2E_COOKIE is not set");
            return;
        };
        let song_id = std::env::var("NETEASE_E2E_SONG_ID")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(1_824_020_871);
        let source_id =
            std::env::var("NETEASE_E2E_SOURCE_ID").unwrap_or_else(|_| "7276012468".to_string());
        let response = tauri::async_runtime::block_on(report_playback(PlaybackReportRequest {
            cookie,
            song_id,
            source_id: Some(source_id),
            play_time: 60,
            total_time: Some(245),
            bitrate: Some(320),
            level: Some("exhigh".to_string()),
            mode: Some("both".to_string()),
            dry_run: Some(false),
        }))
        .expect("real account e2e response");

        assert_eq!(response.code, 200);
        let eapi = response.eapi.as_ref().expect("eapi result");
        assert_eq!(eapi.get("code").and_then(Value::as_i64), Some(200));
        assert_eq!(
            eapi.pointer("/details/startplay/http_status")
                .and_then(Value::as_i64),
            Some(200)
        );
        assert_eq!(
            eapi.pointer("/details/play/http_status")
                .and_then(Value::as_i64),
            Some(200)
        );

        let ncbl = response.ncbl.as_ref().expect("ncbl result");
        assert_eq!(ncbl.get("code").and_then(Value::as_i64), Some(200));
        assert_eq!(
            ncbl.pointer("/plv/success").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            ncbl.pointer("/pld/success").and_then(Value::as_bool),
            Some(true)
        );
    }
}
