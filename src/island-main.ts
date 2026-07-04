import { createApp } from "vue";
import { createPinia } from "pinia";
import IslandApp from "./IslandApp.vue";

const app = createApp(IslandApp);
app.use(createPinia());
app.mount("#app");
