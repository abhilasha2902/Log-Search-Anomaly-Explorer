import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client.ts";
import { makeProject, renderApp } from "../test/helpers.tsx";

vi.mock("../api/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.ts")>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      listProjects: vi.fn(),
      createProject: vi.fn(),
      getLogs: vi.fn(),
    },
  };
});

const unauthenticated = () => new ApiError(401, "unauthenticated", null);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listProjects).mockResolvedValue([makeProject("p1", "demo")]);
  vi.mocked(api.getLogs).mockResolvedValue({ items: [], nextCursor: null });
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, button: string) {
  await user.type(screen.getByLabelText("Email"), "me@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: button }));
}

describe("auth flow", () => {
  it("sends a signed-out visitor to the login page", async () => {
    vi.mocked(api.me).mockRejectedValue(unauthenticated());
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("signs in and lands on the explorer", async () => {
    const user = userEvent.setup();
    vi.mocked(api.me).mockRejectedValue(unauthenticated());
    vi.mocked(api.login).mockResolvedValue({ id: "u1" });
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(api.login).toHaveBeenCalledWith("me@example.com", "password123");
    expect(await screen.findByRole("heading", { name: "Log Explorer" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/(\?.*)?$/);
  });

  it("shows a friendly message for wrong credentials", async () => {
    const user = userEvent.setup();
    vi.mocked(api.me).mockRejectedValue(unauthenticated());
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, "invalid_credentials", null));
    renderApp("/login");
    await screen.findByLabelText("Email");
    await fillAndSubmit(user, "Sign in");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("registers and then signs the new user in", async () => {
    const user = userEvent.setup();
    vi.mocked(api.me).mockRejectedValue(unauthenticated());
    vi.mocked(api.register).mockResolvedValue({ id: "u1" });
    vi.mocked(api.login).mockResolvedValue({ id: "u1" });
    renderApp("/register");
    await screen.findByLabelText("Email");
    await fillAndSubmit(user, "Create account");

    expect(api.register).toHaveBeenCalledWith("me@example.com", "password123");
    expect(api.login).toHaveBeenCalledWith("me@example.com", "password123");
    expect(await screen.findByRole("heading", { name: "Log Explorer" })).toBeInTheDocument();
  });

  it("explains a duplicate email", async () => {
    const user = userEvent.setup();
    vi.mocked(api.me).mockRejectedValue(unauthenticated());
    vi.mocked(api.register).mockRejectedValue(new ApiError(409, "email_taken", null));
    renderApp("/register");
    await screen.findByLabelText("Email");
    await fillAndSubmit(user, "Create account");
    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
  });

  it("keeps a signed-in user on the explorer and signs out back to login", async () => {
    const user = userEvent.setup();
    vi.mocked(api.me).mockResolvedValue({ id: "u1" });
    vi.mocked(api.logout).mockResolvedValue({ ok: true });
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Log Explorer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
