import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// PageShell now mounts the real TopNav, which reaches into AuthProvider +
// TanStack Query for user/org/rate-limit/settings state. Setting up all of
// that in every detail/list test is noise — the tests exist to assert page
// behaviour, not nav behaviour (TopNav has its own tests). Stub it out
// globally so pages that use PageShell render cleanly with just MemoryRouter.
vi.mock("@/components/TopNav", () => ({
  TopNav: () => null,
}));
