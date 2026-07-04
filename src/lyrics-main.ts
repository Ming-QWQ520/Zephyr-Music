import { createApp } from "vue";
import { createPinia } from "pinia";
import LyricsApp from "./LyricsApp.vue";

const app = createApp(LyricsApp);
app.use(createPinia());
app.mount("#app");
