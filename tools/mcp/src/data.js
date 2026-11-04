// Datenzugriff auf users/{uid}/… – liest/schreibt in denselben Formen wie js/store.js und js/alltag/db.js.
import { Firestore, FirestoreError } from "./firestore.js";
import { mergeSettings, normTodo, nextRev, UserError } from "./logic.js";

export class Data {
  constructor(fs, uid, now) {
    this.fs = fs;
    this.uid = uid;
    this.now = now;
    this.cache = new Map();
  }

  p(sub) { return `users/${this.uid}/${sub}`; }

  once(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }
  invalidate(...keys) { for (const k of keys) this.cache.delete(k); }

  settings() {
    return this.once("settings", async () => {
      const d = await this.fs.get(this.p("meta/settings"));
      return mergeSettings(d ? d.data : null);
    });
  }

  state() {
    return this.once("state", async () => {
      const d = await this.fs.get(this.p("meta/state"));
      return { running: d ? d.data.running ?? null : null, rev: d ? Number(d.data.rev) || 0 : 0 };
    });
  }

  places() {
    return this.once("places", async () => {
      const docs = await this.fs.list(this.p("places"));
      return docs.map((d) => ({ ...d.data, id: d.id }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));
    });
  }

  todos() {
    return this.once("todos", async () => {
      const docs = await this.fs.list(this.p("todos"));
      return docs.map((d) => normTodo(d.data, d.id, this.now));
    });
  }

  /** Alle Einträge (für Überstundenkonto nur die nötigen Felder). */
  entriesAll({ light = false } = {}) {
    return this.once("entries:" + light, async () => {
      const mask = light ? ["start", "end", "pauseMin", "kind", "creditMin"] : null;
      const docs = await this.fs.list(this.p("entries"), { mask, pageSize: 1000 });
      return docs.map((d) => ({ ...d.data, id: d.id }));
    });
  }

  /** Einträge mit start in [fromTs, toTs). */
  async entriesRange(fromTs, toTs) {
    const docs = await this.fs.runQuery(`users/${this.uid}`, {
      from: [{ collectionId: "entries" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "start" }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(Math.floor(fromTs)) } } },
            { fieldFilter: { field: { fieldPath: "start" }, op: "LESS_THAN", value: { integerValue: String(Math.floor(toTs)) } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "start" }, direction: "ASCENDING" }],
    });
    return docs.map((d) => ({ ...d.data, id: d.id }));
  }

  /** Alltag-Sammlung users/{uid}/a_<name> (leer, wenn es sie nicht gibt). */
  alltag(name) {
    return this.once("a_" + name, async () => {
      const docs = await this.fs.list(this.p("a_" + name));
      return docs.map((d) => ({ ...d.data, id: d.id }));
    });
  }

  async commit(writes) {
    await this.fs.commit(writes);
  }

  /**
   * Laufende Schicht in einer Transaktion ändern (gleiche rev-Regel wie store.setRunning):
   * fn(running) → { running: neu, writes?: [weitere Schreibvorgänge NACH meta/state], result, unchanged? }.
   */
  async mutateRunning(fn) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await this.fs.beginTransaction();
      let committed = false;
      try {
        const d = await this.fs.get(this.p("meta/state"), { transaction: tx });
        const cur = { running: d ? d.data.running ?? null : null, rev: d ? Number(d.data.rev) || 0 : 0 };
        const now = this.now;
        const out = fn(cur.running, now);
        if (out.unchanged) { await this.fs.rollback(tx); committed = true; return { ...out, before: cur.running }; }
        const rev = nextRev(cur.rev, now);
        const writes = [this.fs.setWrite(this.p("meta/state"), { running: out.running ?? null, rev }), ...(out.writes || [])];
        await this.fs.commit(writes, tx);
        committed = true;
        this.invalidate("state", "entries:true", "entries:false");
        return { ...out, rev, before: cur.running };
      } catch (e) {
        if (!committed) await this.fs.rollback(tx);
        if (e instanceof UserError) throw e;
        lastErr = e;
        if (e instanceof FirestoreError && (e.status === 409 || e.code === "ABORTED")) continue; // Konflikt → nochmal
        throw e;
      }
    }
    throw lastErr || new Error("Speichern nicht möglich (Konflikt).");
  }
}

export { Firestore };
