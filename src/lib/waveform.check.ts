// Self-check for the analysis queue — the non-trivial part of waveform.ts is
// the scheduler (one decode at a time, urgent jumps the queue, one callback
// per caller, failures report null), not the DSP.
//   node --experimental-strip-types src/lib/waveform.check.ts
import assert from "node:assert/strict";

const fetched: string[] = [];
const gate: (() => void)[] = [];

// Minimal browser stubs: each fetch parks until the test releases it, so the
// queue's ordering is observable.
(globalThis as any).fetch = (url: string) => {
  fetched.push(url);
  return new Promise((resolve, reject) => {
    gate.push(() =>
      url.includes("boom")
        ? reject(new Error("dead stream"))
        : resolve({ arrayBuffer: async () => new ArrayBuffer(8) })
    );
  });
};
(globalThis as any).AudioContext = class {
  sampleRate = 44100;
  async decodeAudioData() {
    return { sampleRate: 44100, getChannelData: () => new Float32Array(1000) };
  }
};

const { computeAnalysis, getCachedAnalysis } = await import("./waveform.ts");

const done: string[] = [];
const results = new Map<string, unknown>();
const track = (id: string, urgent = false) =>
  computeAnalysis(id, `https://s/${id}`, (r) => {
    done.push(id);
    results.set(id, r);
  }, urgent);

/** Lets the in-flight fetch finish and drains the microtask queue. */
const tick = async () => {
  gate.shift()?.();
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

track("a");
track("b");
track("boom");
assert.deepEqual(fetched, ["https://s/a"], "only one fetch in flight at a time");

track("c", true); // urgent — jumps ahead of the queued b/boom
track("b"); // second listener on an already-queued track: no second fetch
await tick();

assert.deepEqual(fetched, ["https://s/a", "https://s/c"], "urgent runs next");
assert.deepEqual(done, ["a"]);
assert.ok(getCachedAnalysis("a"), "successful analysis is cached");

await tick(); // c
await tick(); // b
assert.deepEqual(done, ["a", "c", "b", "b"], "every caller gets exactly one callback");
assert.equal(fetched.filter((u) => u.endsWith("/b")).length, 1, "a queued track is fetched once");

await tick(); // boom
assert.equal(results.get("boom"), null, "a failed decode reports null");
assert.equal(getCachedAnalysis("boom"), null, "and stays uncached");

// A cached track calls back synchronously, without queueing anything.
let sync = false;
track("a");
sync = done.at(-1) === "a";
assert.ok(sync, "cache hits are synchronous");
assert.equal(fetched.length, 4, "cache hits never fetch");

console.log("waveform queue: ok");
