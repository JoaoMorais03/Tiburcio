// __tests__/components/AuthView.test.ts — AuthView component tests.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthView from "@/views/AuthView.vue";

// Stub vue-router
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Stub lucide icons
vi.mock("lucide-vue-next", () => ({
  LogIn: { template: "<span>login-icon</span>" },
  UserPlus: { template: "<span>register-icon</span>" },
}));

describe("AuthView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders login mode by default", () => {
    const wrapper = mount(AuthView);
    expect(wrapper.find("button[type='submit']").text()).toBe("Sign in");
  });

  it("switches to register mode when tab clicked", async () => {
    const wrapper = mount(AuthView);

    // Click the Register tab
    const tabs = wrapper.findAll(".flex.gap-1 button");
    const registerTab = tabs.find((t) => t.text().includes("Register"));
    await registerTab?.trigger("click");

    expect(wrapper.find("button[type='submit']").text()).toBe("Create account");
  });

  it("toggles mode via the bottom link", async () => {
    const wrapper = mount(AuthView);

    // Click "Register" link at bottom
    const link = wrapper.find("p.text-center button");
    expect(link.text()).toBe("Register");
    await link.trigger("click");

    expect(wrapper.find("button[type='submit']").text()).toBe("Create account");

    // Click "Login" link at bottom
    const loginLink = wrapper.find("p.text-center button");
    expect(loginLink.text()).toBe("Login");
    await loginLink.trigger("click");

    expect(wrapper.find("button[type='submit']").text()).toBe("Sign in");
  });

  it("shows correct password placeholder per mode", async () => {
    const wrapper = mount(AuthView);

    // Login mode
    expect(wrapper.find("input[type='password']").attributes("placeholder")).toBe("Enter password");

    // Switch to register
    const tabs = wrapper.findAll(".flex.gap-1 button");
    const registerTab = tabs.find((t) => t.text().includes("Register"));
    await registerTab?.trigger("click");

    expect(wrapper.find("input[type='password']").attributes("placeholder")).toBe(
      "Min. 8 characters",
    );
  });
});
