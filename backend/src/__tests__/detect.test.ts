// Tests for detect.ts — language detection, layer detection, and known-language check.

import { describe, expect, it } from "vitest";
import { detectLanguage, detectLayer, isKnownLanguage } from "../mastra/tools/detect.js";

describe("detectLanguage", () => {
  it("returns typescript for .ts files", () => {
    expect(detectLanguage("src/services/UserService.ts")).toBe("typescript");
  });

  it("returns typescript for .tsx files", () => {
    expect(detectLanguage("src/components/Button.tsx")).toBe("typescript");
  });

  it("returns java for .java files", () => {
    expect(detectLanguage("src/services/UserService.java")).toBe("java");
  });

  it("returns vue for .vue files", () => {
    expect(detectLanguage("src/components/Header.vue")).toBe("vue");
  });

  it("returns sql for .sql files", () => {
    expect(detectLanguage("migrations/001_init.sql")).toBe("sql");
  });

  it("returns typescript as fallback for unknown extensions", () => {
    expect(detectLanguage("README.md")).toBe("typescript");
    expect(detectLanguage("config.yaml")).toBe("typescript");
    expect(detectLanguage("Dockerfile")).toBe("typescript");
  });
});

describe("detectLayer", () => {
  it("detects service layer", () => {
    expect(detectLayer("src/services/PaymentService.java")).toBe("service");
  });

  it("detects controller layer from /routes/", () => {
    expect(detectLayer("src/routes/auth.ts")).toBe("controller");
  });

  it("detects controller layer from /controllers/", () => {
    expect(detectLayer("src/controllers/UserController.java")).toBe("controller");
  });

  it("detects repository layer", () => {
    expect(detectLayer("src/repository/UserRepository.java")).toBe("repository");
    expect(detectLayer("src/repositories/OrderRepo.java")).toBe("repository");
  });

  it("detects model layer", () => {
    expect(detectLayer("src/model/User.java")).toBe("model");
    expect(detectLayer("src/models/Order.ts")).toBe("model");
  });

  it("detects component layer", () => {
    expect(detectLayer("src/components/Button.vue")).toBe("component");
  });

  it("detects store layer", () => {
    expect(detectLayer("src/stores/auth.ts")).toBe("store");
    expect(detectLayer("src/store/chat.ts")).toBe("store");
  });

  it("detects page layer", () => {
    expect(detectLayer("src/pages/Home.vue")).toBe("page");
    expect(detectLayer("src/views/Dashboard.vue")).toBe("page");
  });

  it("detects config layer", () => {
    expect(detectLayer("src/config/env.ts")).toBe("config");
  });

  it("detects dto layer", () => {
    expect(detectLayer("src/dto/CreateUserRequest.java")).toBe("dto");
  });

  it("detects batch layer", () => {
    expect(detectLayer("src/batch/NightlyJob.java")).toBe("batch");
  });

  it("detects composable layer", () => {
    expect(detectLayer("src/composables/useAuth.ts")).toBe("composable");
  });

  it("returns other for unrecognized paths", () => {
    expect(detectLayer("src/utils/helpers.ts")).toBe("other");
    expect(detectLayer("index.ts")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(detectLayer("src/Services/PaymentService.java")).toBe("service");
    expect(detectLayer("src/CONTROLLERS/UserController.java")).toBe("controller");
  });
});

describe("isKnownLanguage", () => {
  it("returns true for known extensions", () => {
    expect(isKnownLanguage("file.ts")).toBe(true);
    expect(isKnownLanguage("file.tsx")).toBe(true);
    expect(isKnownLanguage("file.java")).toBe(true);
    expect(isKnownLanguage("file.vue")).toBe(true);
    expect(isKnownLanguage("file.sql")).toBe(true);
  });

  it("returns false for unknown extensions", () => {
    expect(isKnownLanguage("file.md")).toBe(false);
    expect(isKnownLanguage("file.yaml")).toBe(false);
    expect(isKnownLanguage("file.json")).toBe(false);
    expect(isKnownLanguage("file.py")).toBe(false);
    expect(isKnownLanguage("Dockerfile")).toBe(false);
  });
});
