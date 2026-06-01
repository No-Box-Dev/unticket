import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the cross-package helpers the queue consumer dispatches to.
vi.mock("../reconcile.js", () => ({ reconcileOrg: vi.fn() }));
vi.mock("../../../functions/lib/narrator.js", () => ({ narrateEvent: vi.fn() }));
vi.mock("../../../functions/lib/feature-matcher.js", () => ({ matchPRToFeatures: vi.fn() }));
vi.mock("../../../functions/lib/github-sync.js", () => ({
  bootstrapInstallation: vi.fn(),
  syncRepo: vi.fn(),
}));
vi.mock("../../../functions/lib/github-app.js", () => ({
  getInstallationToken: vi.fn().mockResolvedValue("install-token"),
}));
vi.mock("../../../functions/lib/op-failures.js", () => ({ recordFailure: vi.fn() }));

import worker from "../index.js";
import { narrateEvent } from "../../../functions/lib/narrator.js";
import { matchPRToFeatures } from "../../../functions/lib/feature-matcher.js";
import { syncRepo } from "../../../functions/lib/github-sync.js";
import { getInstallationToken } from "../../../functions/lib/github-app.js";
import { recordFailure } from "../../../functions/lib/op-failures.js";

const env = { DB: {} };

function msg(body, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

beforeEach(() => vi.clearAllMocks());

describe("cron queue consumer", () => {
  it("dispatches a narrate task and acks", async () => {
    const m = msg({ type: "narrate", eventId: 7 });
    await worker.queue({ messages: [m] }, env);
    expect(narrateEvent).toHaveBeenCalledWith(env, 7);
    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("dispatches a match_pr task", async () => {
    const pr = { number: 5 };
    const m = msg({ type: "match_pr", orgId: 1, repo: "api", pr });
    await worker.queue({ messages: [m] }, env);
    expect(matchPRToFeatures).toHaveBeenCalledWith(env, 1, "api", pr);
    expect(m.ack).toHaveBeenCalledOnce();
  });

  it("resolves an install token before running sync_repo", async () => {
    const m = msg({ type: "sync_repo", orgId: 1, accountLogin: "acme", installationId: 100, repo: "api" });
    await worker.queue({ messages: [m] }, env);
    expect(getInstallationToken).toHaveBeenCalledWith(env, 100);
    expect(syncRepo).toHaveBeenCalledWith(env.DB, "install-token", 1, "acme", "api", true);
    expect(m.ack).toHaveBeenCalledOnce();
  });

  it("retries (does not ack) a failing task before the delivery limit", async () => {
    narrateEvent.mockRejectedValueOnce(new Error("boom"));
    const m = msg({ type: "narrate", eventId: 1 }, 1);
    await worker.queue({ messages: [m] }, env);
    expect(m.retry).toHaveBeenCalledOnce();
    expect(m.ack).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("records to op_failures and acks once the delivery limit is reached", async () => {
    narrateEvent.mockRejectedValueOnce(new Error("boom"));
    const m = msg({ type: "narrate", eventId: 1, ownerId: "acme", deliveryId: "d-1" }, 4);
    await worker.queue({ messages: [m] }, env);
    expect(recordFailure).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ ownerId: "acme", op: "task:narrate", deliveryId: "d-1" }),
    );
    expect(m.ack).toHaveBeenCalledOnce();
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("treats an unknown task type as a failure", async () => {
    const m = msg({ type: "nope" }, 1);
    await worker.queue({ messages: [m] }, env);
    expect(m.retry).toHaveBeenCalledOnce();
  });
});
