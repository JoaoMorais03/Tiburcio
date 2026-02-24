// main.ts — Application entry point. Registers Pinia, Vue Query, and router.

import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { vueQueryOptions } from "./lib/query.js";
import { reportWebVitals } from "./lib/web-vitals.js";
import router from "./router/index.js";
import "./assets/index.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, vueQueryOptions);

app.mount("#app");

reportWebVitals();
