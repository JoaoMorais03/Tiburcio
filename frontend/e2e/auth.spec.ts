import { test, expect } from "@playwright/test";

const uniqueUser = `testuser_${Date.now()}`;
const password = "testpassword123";

test.describe("Authentication", () => {
  test("registers a new account and redirects to chat", async ({ page }) => {
    await page.goto("/auth");

    // Switch to register tab
    await page.getByRole("button", { name: "Register" }).first().click();

    await page.getByPlaceholder("Enter username").fill(uniqueUser);
    await page.getByPlaceholder("Min. 8 characters").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // Should redirect to chat
    await expect(page).toHaveURL("/", { timeout: 5000 });
    await expect(page.getByText("Tiburcio")).toBeVisible();
  });

  test("logs out and redirects to auth", async ({ page }) => {
    // Login first
    await page.goto("/auth");
    await page.getByPlaceholder("Enter username").fill(uniqueUser);
    await page.getByPlaceholder("Enter password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/", { timeout: 5000 });

    // Logout
    await page.getByTitle("Sign out").click();
    await expect(page).toHaveURL("/auth", { timeout: 5000 });
  });

  test("shows error for invalid login", async ({ page }) => {
    await page.goto("/auth");

    await page.getByPlaceholder("Enter username").fill("nonexistent");
    await page.getByPlaceholder("Enter password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(/invalid|failed|error/i)).toBeVisible({ timeout: 5000 });
  });

  test("redirects unauthenticated users to auth page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/auth", { timeout: 5000 });
  });
});
