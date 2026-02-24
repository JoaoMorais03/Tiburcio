import { test, expect } from "@playwright/test";

const username = `chatuser_${Date.now()}`;
const password = "testpassword123";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    // Register + login
    await page.goto("/auth");
    await page.getByRole("button", { name: "Register" }).first().click();
    await page.getByPlaceholder("Enter username").fill(username);
    await page.getByPlaceholder("Min. 8 characters").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });

  test("sends a message and receives a streaming response", async ({ page }) => {
    // Type and send a message
    const input = page.getByPlaceholder(/ask|message|type/i);
    await input.fill("What are the coding conventions?");
    await input.press("Enter");

    // User message should appear
    await expect(page.getByText("What are the coding conventions?")).toBeVisible();

    // Wait for assistant response (streaming dots or actual content)
    await expect(
      page.locator(".is-assistant").first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("navigates between conversations from sidebar", async ({ page }) => {
    // Send a message to create a conversation
    const input = page.getByPlaceholder(/ask|message|type/i);
    await input.fill("Hello");
    await input.press("Enter");

    // Wait for response
    await expect(page.locator(".is-assistant").first()).toBeVisible({ timeout: 30000 });

    // Click "New chat" in sidebar
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL("/", { timeout: 5000 });

    // The conversation list should show the previous chat
    await expect(page.locator("aside")).toContainText(/Hello|Untitled/i);
  });

  test("deletes a conversation", async ({ page }) => {
    // Create a conversation
    const input = page.getByPlaceholder(/ask|message|type/i);
    await input.fill("Test message for deletion");
    await input.press("Enter");
    await expect(page.locator(".is-assistant").first()).toBeVisible({ timeout: 30000 });

    // Navigate to chats list
    await page.getByRole("link", { name: "Chats" }).click();
    await expect(page).toHaveURL("/chats", { timeout: 5000 });

    // Delete the conversation (hover to reveal delete button)
    const chatItem = page.locator("[class*='cursor-pointer']").first();
    await chatItem.hover();
    const deleteButton = chatItem.locator("button");
    await deleteButton.click();

    // Toast confirmation
    await expect(page.getByText("Conversation deleted")).toBeVisible({ timeout: 5000 });
  });
});
