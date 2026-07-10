import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";
import "./nmn-overrides.css";
const app = createApp(App);
app.use(createPinia());
app.mount("#app");

// 全局：禁用空格键滚动页面（保留输入框内的空格输入）
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
  }
}, { passive: false });
