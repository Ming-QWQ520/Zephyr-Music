/**
 * 网易云登录逻辑（从 App.vue 提取）
 *
 * 管理登录状态、二维码登录流程、手机/邮箱登录、退出登录。
 * 内置防呆校验（手机号/邮箱格式）、国家码选择、验证码倒计时、登录错误码文案映射。
 */
import { ref, computed } from "vue";
import {
  getCookie, getCachedUser, logout, setCookie,
  qrKey, qrCreate, qrCheck, _cachedUser,
  loginCellphone, loginEmail, captchaSent, captchaVerify,
  countriesCodeList, cellphoneExistenceCheck,
  type CountryCodeGroup,
} from "@/api/netease";
import { useNeteaseUser } from "./useNeteaseUser";
import { useToast } from "./useToast";

/** 邮箱基础格式；网易云邮箱登录接口仅支持网易邮箱账号。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NETEASE_EMAIL_DOMAINS = new Set(["163.com", "126.com", "yeah.net"]);
const MAX_PASSWORD_LEN = 128;
/** 验证码倒计时秒数 */
const CAPTCHA_COUNTDOWN = 60;

/** 手机验证码登录错误码 → 文案 */
function describeCellphoneError(code: number, mode: "captcha" | "password"): string {
  switch (code) {
    case 250: return "触发风控，请稍后重试或使用扫码登录";
    case 400: return "参数有误，请检查手机号与国家码";
    case 501: return "该手机号未注册";
    case 502: return mode === "captcha" ? "验证码无效或已过期" : "密码错误";
    case 503: return "验证码错误";
    case 509: return "操作过于频繁，请稍后再试";
    default: return `登录失败 (code: ${code})`;
  }
}

/** 邮箱登录错误码 → 文案 */
function describeEmailError(code: number): string {
  switch (code) {
    case 501: return "账号不存在";
    case 502: return "账号或密码错误";
    case 509: return "操作过于频繁，请稍后再试";
    default: return `登录失败 (code: ${code})`;
  }
}

export function useNeteaseAuth() {
  const neLoggedIn = ref(false);
  // neUser 直接引用 _cachedUser，这样 userDetail 合并的 signature/gender/city 等字段
  // 会自动反映到 App.vue 的用户卡片中。
  const neUser = _cachedUser;
  const showLoginDropdown = ref(false);

  // 二维码登录
  const qrCodeImg = ref("");
  const qrStatus = ref<"idle" | "loading" | "waiting" | "expired">("idle");
  const qrMessage = ref("");
  let qrCheckTimer: ReturnType<typeof setInterval> | null = null;
  let qrKeyVal = "";
  let qrRequestId = 0;

  // 登录弹窗
  const showLoginModal = ref(false);
  const loginTab = ref<"qr" | "phone" | "email">("qr");
  const loginLoading = ref(false);
  const loginError = ref("");

  // 手机登录：countrycode 默认 86（中国）；loginMode 区分验证码/密码登录
  const phoneForm = ref({ phone: "", password: "", captcha: "", countrycode: "86" });
  const phoneLoginMode = ref<"captcha" | "password">("captcha");
  const showPhonePassword = ref(false);
  const captchaSentFlag = ref(false);
  const captchaCountdown = ref(0);
  const captchaSending = ref(false);
  let captchaTimer: ReturnType<typeof setInterval> | null = null;
  let captchaRequestId = 0;

  // 邮箱登录
  const emailForm = ref({ email: "", password: "" });
  const showEmailPassword = ref(false);

  // 国家码选择器
  const countryGroups = ref<CountryCodeGroup[]>([]);
  const countryLoading = ref(false);
  const showCountryPicker = ref(false);
  const countrySearch = ref("");
  const manualCountryCode = ref("");
  const selectedCountryOverride = ref("");

  const { loadVipAndListenData } = useNeteaseUser();

  // ===== 防呆校验 =====

  /** 手机号是否合法：中国区(86)要求 1 开头 11 位；其他国家符合 E.164 的 4-15 位数字范围。 */
  function isValidPhone(phone: string, countrycode: string): boolean {
    const p = phone.trim();
    if (!/^\d+$/.test(p)) return false;
    if (countrycode === "86" || !countrycode) return /^1\d{10}$/.test(p);
    return p.length >= 4 && p.length + countrycode.length <= 15;
  }

  function getEmailValidationMessage(email: string): string {
    const value = email.trim().toLowerCase();
    if (!value) return "";
    if (value.length > 254 || !EMAIL_RE.test(value)) return "邮箱格式不正确";
    const [local, domain] = value.split("@");
    if (!local || local.length > 64) return "邮箱格式不正确";
    if (!NETEASE_EMAIL_DOMAINS.has(domain)) return "仅支持 163、126 或 yeah.net 网易邮箱";
    return "";
  }

  const countryCodeValid = computed(() => /^[1-9]\d{0,3}$/.test(phoneForm.value.countrycode));
  const phoneValid = computed(() =>
    countryCodeValid.value && isValidPhone(phoneForm.value.phone, phoneForm.value.countrycode)
  );
  const captchaValid = computed(() => /^\d{4,6}$/.test(phoneForm.value.captcha.trim()));
  const emailValidationMessage = computed(() => getEmailValidationMessage(emailForm.value.email));
  const emailValid = computed(() =>
    !!emailForm.value.email.trim() && !emailValidationMessage.value
  );
  const phoneValidationMessage = computed(() => {
    if (!countryCodeValid.value) return "请选择或输入有效国家/地区码";
    if (!phoneForm.value.phone) return "";
    return phoneForm.value.countrycode === "86"
      ? "中国大陆手机号应为 1 开头的 11 位数字"
      : "请输入符合国际格式的有效手机号";
  });

  /** 能否发送验证码：手机号合法且未在倒计时 */
  const canSendCaptcha = computed(() =>
    phoneValid.value &&
    captchaCountdown.value === 0 &&
    !captchaSending.value &&
    !loginLoading.value
  );

  /** 能否提交手机登录 */
  const canSubmitPhone = computed(() => {
    if (!phoneValid.value || loginLoading.value) return false;
    return phoneLoginMode.value === "captcha"
      ? captchaValid.value
      : phoneForm.value.password.length > 0 && phoneForm.value.password.length <= MAX_PASSWORD_LEN;
  });

  /** 能否提交邮箱登录 */
  const canSubmitEmail = computed(() =>
    emailValid.value &&
    emailForm.value.password.length > 0 &&
    emailForm.value.password.length <= MAX_PASSWORD_LEN &&
    !loginLoading.value
  );

  /** 当前选中的国家码显示（如 "+86"） */
  const countryCodeLabel = computed(() => `+${phoneForm.value.countrycode || "86"}`);
  const selectedCountryName = computed(() => {
    if (selectedCountryOverride.value) return selectedCountryOverride.value;
    const matches: string[] = [];
    for (const group of countryGroups.value) {
      for (const country of group.countryList) {
        if (country.code === phoneForm.value.countrycode && !matches.includes(country.zh)) {
          matches.push(country.zh);
        }
      }
    }
    if (matches.length > 1) return matches.slice(0, 2).join("/");
    if (matches.length === 1) return matches[0];
    return phoneForm.value.countrycode === "86" ? "中国大陆" : "自定义区号";
  });

  /** 按搜索关键字过滤国家码分组 */
  const filteredCountryGroups = computed<CountryCodeGroup[]>(() => {
    const q = countrySearch.value.trim().toLowerCase();
    if (!q) return countryGroups.value;
    const out: CountryCodeGroup[] = [];
    for (const g of countryGroups.value) {
      const list = g.countryList.filter(c =>
        c.zh.toLowerCase().includes(q) ||
        c.en.toLowerCase().includes(q) ||
        c.code.includes(q) ||
        c.locale.toLowerCase().includes(q)
      );
      if (list.length) out.push({ label: g.label, countryList: list });
    }
    return out;
  });

  /** 清空校验错误提示（用户编辑输入时调用） */
  function clearError() { if (loginError.value) loginError.value = ""; }

  /** 规范化手机号输入；支持直接粘贴“+86 138...”并自动拆分国家码。 */
  function onPhoneInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const raw = target.value;
    const previousPhone = phoneForm.value.phone;
    const previousCountryCode = phoneForm.value.countrycode;
    let digits = raw.replace(/\D/g, "");
    if (raw.trim().startsWith("+") && digits) {
      const knownCodes = new Set<string>(["86"]);
      for (const group of countryGroups.value) {
        for (const country of group.countryList) knownCodes.add(country.code);
      }
      const matchedCode = [...knownCodes]
        .sort((a, b) => b.length - a.length)
        .find(code => digits.startsWith(code) && digits.length - code.length >= 4);
      if (matchedCode) {
        phoneForm.value.countrycode = matchedCode;
        selectedCountryOverride.value = "";
        digits = digits.slice(matchedCode.length);
      }
    }
    const maxLocalDigits = Math.max(4, 15 - phoneForm.value.countrycode.length);
    const next = digits.slice(0, maxLocalDigits);
    if (previousPhone !== next || previousCountryCode !== phoneForm.value.countrycode) {
      phoneForm.value.phone = next;
      captchaSentFlag.value = false;
      captchaRequestId += 1;
      captchaSending.value = false;
      stopCaptchaCountdown();
    }
    target.value = next;
    clearError();
  }

  /** 验证码只保留数字，避免粘贴短信时带入空格或横线。 */
  function onCaptchaInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const next = target.value.replace(/\D/g, "").slice(0, 6);
    phoneForm.value.captcha = next;
    target.value = next;
    clearError();
  }

  function onEmailBlur() {
    emailForm.value.email = emailForm.value.email.trim().toLowerCase();
    clearError();
  }

  /** 检查登录状态。
   *  启动初期网络可能未就绪导致请求失败，失败时延迟重试一次，
   *  避免"有 cookie 却显示未登录"需要重启才恢复。 */
  async function checkNeLogin(retry = true) {
    if (!getCookie()) return;
    const user = await getCachedUser();
    if (user) {
      neLoggedIn.value = true;
      // neUser 即 _cachedUser，getCachedUser 已设置，无需再赋值
      loadVipAndListenData();
    } else if (retry) {
      setTimeout(() => { checkNeLogin(false); }, 3000);
    }
  }

  /** 启动二维码登录 */
  async function startNeLogin() {
    stopNeQrCheck();
    const requestId = qrRequestId;
    qrStatus.value = "loading"; qrMessage.value = "正在生成二维码..."; qrCodeImg.value = "";
    try {
      const keyRes = await qrKey();
      if (requestId !== qrRequestId || !showLoginModal.value || loginTab.value !== "qr") return;
      if (!keyRes.unikey) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
      qrKeyVal = keyRes.unikey;
      const createRes = await qrCreate(qrKeyVal);
      if (requestId !== qrRequestId || !showLoginModal.value || loginTab.value !== "qr") return;
      if (!createRes.qrimg) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
      qrCodeImg.value = createRes.qrimg;
      qrStatus.value = "waiting"; qrMessage.value = "请用网易云音乐 App 扫码";
      qrCheckTimer = setInterval(async () => {
        try {
          const res = await qrCheck(qrKeyVal);
          if (res.code === 800) { qrStatus.value = "expired"; qrMessage.value = "二维码已过期"; stopNeQrCheck(); }
          else if (res.code === 802) { qrMessage.value = "已扫码，请在手机上确认"; }
          else if (res.code === 803) {
            if (res.cookie) setCookie(res.cookie);
            stopNeQrCheck();
            qrMessage.value = "登录成功";
            await checkNeLogin();
            showLoginDropdown.value = false;
            // 登录成功后自动关闭登录弹窗
            closeLoginModal();
            useToast().success("登录成功", neUser.value?.nickname ? `欢迎回来，${neUser.value.nickname}` : "欢迎回来");
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch {
      if (requestId !== qrRequestId) return;
      qrMessage.value = "二维码生成失败，请点击重试";
      qrStatus.value = "idle";
    }
  }

  function stopNeQrCheck() {
    qrRequestId += 1;
    if (qrCheckTimer) {
      clearInterval(qrCheckTimer);
      qrCheckTimer = null;
    }
  }

  /** 退出登录 */
  async function doNeLogout() {
    try { await logout(); } catch { /* ignore */ }
    neLoggedIn.value = false; neUser.value = null;
    showLoginDropdown.value = false;
    qrStatus.value = "idle"; qrCodeImg.value = "";
    useToast().info("已退出登录");
  }

  function closeDropdown() { showLoginDropdown.value = false; }

  /** 加载国家码列表（只加载一次，失败静默降级为仅 +86） */
  async function loadCountryList() {
    if (countryGroups.value.length || countryLoading.value) return;
    countryLoading.value = true;
    try {
      const r = await countriesCodeList();
      if (r.code === 200 && r.data.length) countryGroups.value = r.data;
    } catch { /* 忽略：保留手动输入能力 */ }
    finally { countryLoading.value = false; }
  }

  /** 选择国家码 */
  function selectCountry(code: string, name = "") {
    phoneForm.value.countrycode = code;
    selectedCountryOverride.value = name;
    showCountryPicker.value = false;
    countrySearch.value = "";
    manualCountryCode.value = "";
    captchaSentFlag.value = false;
    captchaRequestId += 1;
    captchaSending.value = false;
    stopCaptchaCountdown();
    clearError();
  }

  /** API 国家码列表不可用或没有目标地区时，允许手动输入作为兜底。 */
  function applyManualCountryCode() {
    const code = manualCountryCode.value.replace(/\D/g, "").slice(0, 4);
    manualCountryCode.value = code;
    if (!/^[1-9]\d{0,3}$/.test(code)) {
      loginError.value = "请输入 1-4 位国家/地区码";
      return;
    }
    selectCountry(code, "自定义区号");
  }

  function toggleCountryPicker() {
    showCountryPicker.value = !showCountryPicker.value;
    if (showCountryPicker.value) loadCountryList();
  }

  function setLoginTab(tab: "qr" | "phone" | "email") {
    if (loginTab.value === tab) return;
    loginTab.value = tab;
    clearError();
    showCountryPicker.value = false;
    if (tab === "qr") startNeLogin();
    else stopNeQrCheck();
    if (tab === "phone") loadCountryList();
  }

  function openLoginModal() {
    showLoginModal.value = true;
    loginTab.value = "qr";
    loginError.value = "";
    // 每次打开都重新生成二维码并开始轮询。
    // 之前只在 idle 时生成：关闭弹窗会停止轮询但状态停留在 waiting，
    // 再次打开会显示一张"死"二维码（扫了也没反应）。
    startNeLogin();
    // 预加载国家码列表，切到手机 tab 时即可直接选择
    loadCountryList();
  }

  function closeLoginModal() {
    showLoginModal.value = false;
    stopNeQrCheck();
    stopCaptchaCountdown();
    qrStatus.value = "idle";
    loginError.value = "";
    showCountryPicker.value = false;
    showPhonePassword.value = false;
    showEmailPassword.value = false;
    phoneForm.value.password = "";
    phoneForm.value.captcha = "";
    emailForm.value.password = "";
    captchaSentFlag.value = false;
    captchaRequestId += 1;
    captchaSending.value = false;
  }

  function stopCaptchaCountdown() {
    if (captchaTimer) { clearInterval(captchaTimer); captchaTimer = null; }
    captchaCountdown.value = 0;
  }

  function startCaptchaCountdown() {
    if (captchaTimer) clearInterval(captchaTimer);
    captchaCountdown.value = CAPTCHA_COUNTDOWN;
    captchaTimer = setInterval(() => {
      captchaCountdown.value -= 1;
      if (captchaCountdown.value <= 0) stopCaptchaCountdown();
    }, 1000);
  }

  /** 手机登录 */
  async function doPhoneLogin() {
    if (!phoneValid.value) {
      loginError.value = phoneValidationMessage.value || "请输入有效手机号";
      return;
    }
    if (phoneLoginMode.value === "captcha" && !captchaValid.value) { loginError.value = "请输入 4-6 位验证码"; return; }
    if (phoneLoginMode.value === "password" && !phoneForm.value.password) { loginError.value = "请输入密码"; return; }
    if (phoneForm.value.password.length > MAX_PASSWORD_LEN) { loginError.value = `密码不能超过 ${MAX_PASSWORD_LEN} 个字符`; return; }
    loginLoading.value = true;
    loginError.value = "";
    try {
      if (phoneLoginMode.value === "captcha") {
        const verification = await captchaVerify(
          phoneForm.value.phone.trim(),
          phoneForm.value.captcha.trim(),
          phoneForm.value.countrycode || undefined,
        );
        if (verification.code !== 200 || verification.data === false) {
          loginError.value = verification.message || "验证码错误或已过期，请重新获取";
          return;
        }
      }
      const res = await loginCellphone({
        phone: phoneForm.value.phone.trim(),
        password: phoneLoginMode.value === "captcha" ? undefined : phoneForm.value.password,
        countrycode: phoneForm.value.countrycode || undefined,
        captcha: phoneLoginMode.value === "captcha" ? phoneForm.value.captcha.trim() : undefined,
      });
      if (res.code === 200 && res.cookie) {
        setCookie(res.cookie);
        await checkNeLogin();
        closeLoginModal();
        useToast().success("登录成功", neUser.value?.nickname ? `欢迎回来，${neUser.value.nickname}` : "欢迎回来");
      } else {
        loginError.value = describeCellphoneError(res.code, phoneLoginMode.value);
      }
    } catch (e) {
      loginError.value = String(e instanceof Error ? e.message : e);
    } finally {
      loginLoading.value = false;
    }
  }

  /** 发送手机验证码（先校验手机号是否已注册，给出清晰提示） */
  async function doSendCaptcha() {
    if (!phoneValid.value) {
      loginError.value = phoneValidationMessage.value || "请输入有效手机号";
      return;
    }
    if (!canSendCaptcha.value) return;
    const requestId = ++captchaRequestId;
    const phone = phoneForm.value.phone.trim();
    const countrycode = phoneForm.value.countrycode || undefined;
    loginError.value = "";
    captchaSending.value = true;
    try {
      // 防呆：未注册的手机号提前提示，避免用户误以为验证码登录能自动注册
      try {
        const chk = await cellphoneExistenceCheck(phone, countrycode);
        if (requestId !== captchaRequestId) return;
        if (chk.code === 200 && chk.exist === 0) {
          loginError.value = "该手机号未注册，请先在网易云 App 注册";
          return;
        }
      } catch {
        if (requestId !== captchaRequestId) return;
        // 校验接口本身失败时不阻断验证码发送。
      }
      const r = await captchaSent(phone, countrycode);
      if (requestId !== captchaRequestId) return;
      if (r.code === 200) {
        captchaSentFlag.value = true;
        startCaptchaCountdown();
        useToast().success("验证码已发送", "请查收短信");
      } else {
        loginError.value = r.message || `验证码发送失败 (code: ${r.code})`;
      }
    } catch (e) {
      if (requestId !== captchaRequestId) return;
      loginError.value = String(e instanceof Error ? e.message : e);
    } finally {
      if (requestId === captchaRequestId) captchaSending.value = false;
    }
  }

  /** 邮箱登录 */
  async function doEmailLogin() {
    if (!emailValid.value) { loginError.value = emailValidationMessage.value || "请输入有效的邮箱地址"; return; }
    if (!emailForm.value.password) { loginError.value = "请输入密码"; return; }
    if (emailForm.value.password.length > MAX_PASSWORD_LEN) { loginError.value = `密码不能超过 ${MAX_PASSWORD_LEN} 个字符`; return; }
    loginLoading.value = true;
    loginError.value = "";
    try {
      const res = await loginEmail(emailForm.value.email.trim().toLowerCase(), emailForm.value.password);
      if (res.code === 200 && res.cookie) {
        setCookie(res.cookie);
        await checkNeLogin();
        closeLoginModal();
        useToast().success("登录成功", neUser.value?.nickname ? `欢迎回来，${neUser.value.nickname}` : "欢迎回来");
      } else {
        loginError.value = describeEmailError(res.code);
      }
    } catch (e) {
      loginError.value = String(e instanceof Error ? e.message : e);
    } finally {
      loginLoading.value = false;
    }
  }

  return {
    // state
    neLoggedIn, neUser, showLoginDropdown,
    qrCodeImg, qrStatus, qrMessage,
    showLoginModal, loginTab, loginLoading, loginError,
    phoneForm, phoneLoginMode, showPhonePassword, captchaSentFlag, captchaCountdown, captchaSending,
    emailForm, showEmailPassword,
    countryGroups, countryLoading, showCountryPicker, countrySearch, manualCountryCode,
    // computed（防呆 + 国家码）
    phoneValid, captchaValid, emailValid, countryCodeValid,
    canSendCaptcha, canSubmitPhone, canSubmitEmail,
    countryCodeLabel, selectedCountryName, filteredCountryGroups,
    phoneValidationMessage, emailValidationMessage,
    // actions
    checkNeLogin, startNeLogin, stopNeQrCheck, doNeLogout,
    closeDropdown, openLoginModal, closeLoginModal, setLoginTab,
    doPhoneLogin, doSendCaptcha, doEmailLogin,
    loadCountryList, selectCountry, applyManualCountryCode, toggleCountryPicker,
    onPhoneInput, onCaptchaInput, onEmailBlur, clearError,
  };
}
