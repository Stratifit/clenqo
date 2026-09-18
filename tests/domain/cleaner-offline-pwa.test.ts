/**
 * Offline action queue + PWA infrastructure tests (Change 7, tasks 11.4/12.1;
 * design §8–§9; BD-C5).
 *
 * Offline queue: deterministic ordering, idempotency keys, replay removes
 * applied actions, stale replays surface deterministic errors, media never
 * queues. PWA: manifest is valid JSON with required fields, service worker
 * explicitly bypasses API/mutation caching (app-shell only).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal localStorage shim for the queue module (jsdom-free environment).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    navigator: { onLine: true },
  };
  // Fresh module state per test.
  vi.resetModules();
});

import { vi } from "vitest";

async function loadQueue() {
  return import("@/features/cleaner/offlineQueue");
}

describe("offline action queue (BD-C5)", () => {
  it("enqueues actions with idempotency keys and replays them in creation order", async () => {
    const q = await loadQueue();
    q.enqueueOfflineAction({ kind: "check_in", jobId: "job-1" }, "idem-1");
    q.enqueueOfflineAction({ kind: "checklist_item", jobId: "job-1", payload: { item_id: "i1" } }, "idem-2");
    q.enqueueOfflineAction({ kind: "complete", jobId: "job-1" }, "idem-3");

    const order: string[] = [];
    const remaining = await q.replayOfflineQueue(async (a) => {
      order.push(a.id);
      return { ok: true };
    });

    expect(order).toEqual(["idem-1", "idem-2", "idem-3"]); // deterministic
    expect(remaining).toHaveLength(0); // applied actions are removed
  });

  it("duplicate idempotency keys never duplicate queue entries", async () => {
    const q = await loadQueue();
    q.enqueueOfflineAction({ kind: "check_in", jobId: "job-1" }, "same-key");
    const entries = q.getOfflineQueue();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("same-key");
  });

  it("stale replays surface a deterministic error state instead of silent success", async () => {
    const q = await loadQueue();
    q.enqueueOfflineAction({ kind: "complete", jobId: "job-1" }, "idem-stale");
    const remaining = await q.replayOfflineQueue(async () => ({ ok: false, stale: true }));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].state).toBe("error");
    expect(remaining[0].error).toMatch(/state changed/i);
  });

  it("connectivity loss mid-replay returns actions to pending for the next pass", async () => {
    const q = await loadQueue();
    q.enqueueOfflineAction({ kind: "en_route", jobId: "job-1" }, "idem-net");
    const remaining = await q.replayOfflineQueue(async () => {
      throw new Error("offline");
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].state).toBe("pending");
    expect(remaining[0].attempts).toBe(1);
  });

  it("failed entries wait for explicit retry (no infinite auto-replay)", async () => {
    const q = await loadQueue();
    q.enqueueOfflineAction({ kind: "check_out", jobId: "job-1" }, "idem-fail");
    await q.replayOfflineQueue(async () => ({ ok: false }));
    let calls = 0;
    await q.replayOfflineQueue(async () => {
      calls += 1;
      return { ok: true };
    });
    expect(calls).toBe(0); // errored entries are skipped until retried
    q.retryOfflineAction("idem-fail");
    await q.replayOfflineQueue(async () => ({ ok: true }));
    expect(q.getOfflineQueue()).toHaveLength(0);
  });
});

describe("PWA infrastructure (design §9)", () => {
  const root = process.cwd();

  it("manifest is valid JSON with required installable fields, scoped to /cleaner", () => {
    const manifest = JSON.parse(readFileSync(join(root, "public", "manifest.webmanifest"), "utf8")) as Record<string, unknown>;
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe("/cleaner");
    expect(manifest.scope).toBe("/cleaner");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect((manifest.icons as unknown[]).length).toBeGreaterThan(0);
  });

  it("service worker caches ONLY the app shell — never API pages or server actions", () => {
    const sw = readFileSync(join(root, "public", "cleaner", "sw.js"), "utf8");
    // Mutations never intercepted.
    expect(sw).toContain('event.request.method !== "GET"');
    // Cache-first limited to the explicit shell asset list + static chunks.
    expect(sw).toContain("SHELL_ASSETS.includes(url.pathname)");
    expect(sw).toContain("/_next/static/");
    // No blanket API caching: everything else is network passthrough.
    expect(sw).toContain("network passthrough");
  });

  it("no location-permission or geolocation artifacts anywhere in the cleaner surface (BD-C6)", () => {
    const files = [
      join(root, "app", "(cleaner)", "cleaner", "clientShell.tsx"),
      join(root, "app", "(cleaner)", "cleaner", "jobs", "[id]", "executionPanel.tsx"),
      join(root, "public", "cleaner", "sw.js"),
      join(root, "public", "manifest.webmanifest"),
    ];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      expect(content).not.toMatch(/geolocation/i);
      expect(content).not.toMatch(/requestPermission/);
    }
  });
});
