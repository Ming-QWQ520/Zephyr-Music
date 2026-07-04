/**
 * 网易云登录逻辑（从 App.vue 提取）
 *
 * 管理登录状态、二维码登录流程、手机/邮箱登录、退出登录。
 */
import { ref } from "vue";
import { log } from "@/composables/logger";
import {
  getCookie, getCachedUser, logout, setCookie,
  qrKey, qrCreate, qrCheck, _cachedUser,
  loginCellphone, loginEmail, captchaSent,
} from "@/api/netease";
import { useNeteaseUser } from "./useNeteaseUser";

export function useNeteaseAuth() {
  const neLoggedIn = ref(false);
  const neUser = ref<{ nickname: string; avatarUrl: string } | null>(null);
  const showLoginDropdown = ref(false);

  // 二维码登录
  const qrCodeImg = ref("");
  const qrStatus = ref<"idle" | "loading" | "waiting" | "expired">("idle");
  const qrMessage = ref("");
  let qrCheckTimer: ReturnType<typeof setInterval> | null = null;
  let qrKeyVal = "";

  // 登录弹窗
  const showLoginModal = ref(false);
  const loginTab = ref<"qr" | "phone" | "email">("qr");
  const loginLoading = ref(false);
  const loginError = ref("");
  const phoneForm = ref({ phone: "", password: "", captcha: "", countrycode: "" });
  const captchaSentFlag = ref(false);
  const emailForm = ref({ email: "", password: "" });

  const { loadVipAndListenData } = useNeteaseUser();

  /** 检查登录状态 */
  async function checkNeLogin() {
    if (!getCookie()) return;
    const user = await getCachedUser();
    if (user) {
      neLoggedIn.value = true;
      neUser.value = { nickname: user.nickname, avatarUrl: user.avatarUrl };
      loadVipAndListenData();
    }
  }

  /** 启动二维码登录 */
  async function startNeLogin() {
    qrStatus.value = "loading"; qrMessage.value = "正在生成二维码..."; qrCodeImg.value = "";
    try {
      const keyRes = await qrKey();
      if (!keyRes.unikey) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
      qrKeyVal = keyRes.unikey;
      const createRes = await qrCreate(qrKeyVal);
      if (!createRes.qrimg) { qrMessage.value = "生成失败"; qrStatus.value = "idle"; return; }
      qrCodeImg.value = createRes.qrimg;
      qrStatus.value = "waiting"; qrMessage.value = "请用网易云音乐 App 扫码";
      stopNeQrCheck();
      qrCheckTimer = setInterval(async () => {
        try {
          const res = await qrCheck(qrKeyVal);
          if (res.code === 800) { qrStatus.value = "expired"; qrMessage.value = "二维码已过期"; stopNeQrCheck(); }
          else if (res.code === 802) { qrMessage.value = "已扫码，请确认"; }
          else if (res.code === 803) {
            if (res.cookie) setCookie(res.cookie);
            stopNeQrCheck();
            await checkNeLogin();
            showLoginDropdown.value = false;
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (e) { qrMessage.value = "出错: " + String(e); qrStatus.value = "idle"; }
  }

  function stopNeQrCheck() { if (qrCheckTimer) { clearInterval(qrCheckTimer); qrCheckTimer = null; } }

  /** 退出登录 */
  async function doNeLogout() {
    try { await logout(); } catch { /* ignore */ }
    neLoggedIn.value = false; neUser.value = null;
    showLoginDropdown.value = false;
    qrStatus.value = "idle"; qrCodeImg.value = "";
  }

  function closeDropdown() { showLoginDropdown.value = false; }

  function openLoginModal() {
    showLoginModal.value = true;
    loginError.value = "";
    if (qrStatus.value === "idle") startNeLogin();
  }

  function closeLoginModal() {
    showLoginModal.value = false;
    stopNeQrCheck();
    loginError.value = "";
  }

  /** 手机登录 */
  async function doPhoneLogin() {
    if (!phoneForm.value.phone) { loginError.value = "请输入手机号"; return; }
    if (!phoneForm.value.password && !phoneForm.value.captcha) { loginError.value = "请输入密码或验证码"; return; }
    loginLoading.value = true;
    loginError.value = "";
    try {
      const res = await loginCellphone({
        phone: phoneForm.value.phone,
        password: phoneForm.value.captcha ? undefined : phoneForm.value.password,
        countrycode: phoneForm.value.countrycode || undefined,
        captcha: phoneForm.value.captcha || undefined,
      });
      if (res.code === 200 && res.cookie) {
        setCookie(res.cookie);
        await checkNeLogin();
        closeLoginModal();
      } else {
        loginError.value = `登录失败 (code: ${res.code})`;
      }
    } catch (e) {
      loginError.value = String(e instanceof Error ? e.message : e);
    } finally {
      loginLoading.value = false;
    }
  }

  /** 发送手机验证码 */
  async function doSendCaptcha() {
    if (!phoneForm.value.phone) { loginError.value = "请输入手机号"; return; }
    try {
      await captchaSent(phoneForm.value.phone, phoneForm.value.countrycode || undefined);
      captchaSentFlag.value = true;
      loginError.value = "验证码已发送";
    } catch (e) {
      loginError.value = String(e instanceof Error ? e.message : e);
    }
  }

  /** 邮箱登录 */
  async function doEmailLogin() {
    if (!emailForm.value.email) { loginError.value = "请输入邮箱"; return; }
    if (!emailForm.value.password) { loginError.value = "请输入密码"; return; }
    loginLoading.value = true;
    loginError.value = "";
    try {
      const res = await loginEmail(emailForm.value.email, emailForm.value.password);
      if (res.code === 200 && res.cookie) {
        setCookie(res.cookie);
        await checkNeLogin();
        closeLoginModal();
      } else {
        loginError.value = `登录失败 (code: ${res.code})`;
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
    phoneForm, captchaSentFlag, emailForm,
    // actions
    checkNeLogin, startNeLogin, stopNeQrCheck, doNeLogout,
    closeDropdown, openLoginModal, closeLoginModal,
    doPhoneLogin, doSendCaptcha, doEmailLogin,
  };
}
