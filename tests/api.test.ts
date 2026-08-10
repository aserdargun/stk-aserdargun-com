import type Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { openDatabase } from "../src/server/db.js";

describe("Stackfolio API", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createApp(db);
  });

  afterEach(() => db.close());

  it("reports a connected SQLite database", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toEqual({ status: "ok", database: "connected", items: 51 });
  });

  it("returns monthly and annual analysis", async () => {
    const response = await request(app).get("/api/dashboard?year=2025").expect(200);
    expect(response.body.year).toBe(2025);
    expect(response.body.metrics.lifetimeSpend).toBe(426621.77);
    expect(response.body.monthlySeries).toHaveLength(12);
    expect(response.body.yearlySeries.map((entry: { year: string }) => entry.year)).toEqual(["2024", "2025", "2026"]);
  });

  it("aggregates every entry in the latest calendar month", async () => {
    const created = await request(app)
      .post("/api/items")
      .send({
        name: "Latest month check",
        category: "Other",
        billingType: "recurring",
        status: "active",
        initialEntry: {
          amount: 10,
          currency: "TRY",
          periodStart: "2026-08-05",
          periodKind: "month",
        },
      })
      .expect(201);
    await request(app)
      .post(`/api/items/${created.body.item.id}/entries`)
      .send({ amount: 15, currency: "TRY", periodStart: "2026-08-25", periodKind: "month" })
      .expect(201);

    const dashboard = await request(app).get("/api/dashboard?year=2026").expect(200);
    expect(dashboard.body.metrics.latestMonthlyPeriod).toBe("2026-08-01");
    expect(dashboard.body.metrics.latestMonthlySpend).toBe(25);
  });

  it("creates a cost, adds an entry, and closes the cost without losing history", async () => {
    const created = await request(app)
      .post("/api/items")
      .send({
        name: "Test platform",
        category: "Platform",
        billingType: "recurring",
        status: "active",
        initialEntry: {
          amount: 100,
          currency: "TRY",
          periodStart: "2026-08-01",
          periodKind: "month",
        },
      })
      .expect(201);

    const id = created.body.item.id as number;
    await request(app)
      .post(`/api/items/${id}/entries`)
      .send({ amount: 125, currency: "TRY", periodStart: "2026-09-01", periodKind: "month" })
      .expect(201);
    const closed = await request(app)
      .patch(`/api/items/${id}`)
      .send({ status: "closed", closedAt: "2026-09-30" })
      .expect(200);

    expect(closed.body.item.status).toBe("closed");
    expect(closed.body.item.closedAt).toBe("2026-09-30");
    expect(closed.body.entries).toHaveLength(2);
  });

  it("rejects invalid cost payloads", async () => {
    const response = await request(app)
      .post("/api/items")
      .send({ name: "", category: "Unknown" })
      .expect(400);
    expect(response.body.error).toBe("Validation failed.");
  });
});
