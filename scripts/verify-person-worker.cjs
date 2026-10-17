#!/usr/bin/env node
/* Worker protocol regressions use deterministic task doubles, not camera files.
 * Actual bundled model quality is verified separately by the vision suite. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), reports = [];
const source = fs.readFileSync(path.join(root, "assets/vendor/vision/meetinglens-worker.js"), "utf8");
const labels = ["background", "hair", "body-skin", "face-skin", "clothes", "accessories"];
function validMasks(background = [0.01, 0.02, 0.03, 0.04, 0.05, 1]) {
  return labels.map((_, index) => ({ width: background.length, height: 1,
    getAsFloat32Array() {
      if (index !== 0) throw new Error("The background complement already contains the complete person union");
      return Float32Array.from(background);
    } }));
}
function worker(config = {}) {
  const messages = [], creations = [], tasks = [], gates = [], executions = [];
  let remainingGates = config.gatedCreations || 0, personCreationCount = 0;
  const face = { detectForVideo: () => ({ faceLandmarks: [] }), close() { this.closed = true; } };
  const gl = {
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext() {} };
      return config.privateRenderer ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
    },
    getParameter: () => config.renderer === undefined ? "ANGLE (Intel, Intel UHD Graphics, D3D11)" : config.renderer
  };
  const self = { location: { href: "http://localhost/assets/vendor/vision/meetinglens-worker.js" },
    postMessage(message, transfers) { messages.push({ ...message, transferCount: transfers?.length || 0 }); } };
  const context = vm.createContext({ self, URL, performance, Uint8ClampedArray, Float32Array,
    OffscreenCanvas: class { getContext() { return config.noWebGL ? null : gl; } },
    importScripts() {
      Object.assign(self.exports, {
        FilesetResolver: { forVisionTasks: async () => ({ wasm: true }) },
        FaceLandmarker: { createFromOptions: async (_files, options) => {
          creations.push({ type: "face", options }); if (config.faceError) throw new Error("Face unavailable for this test"); return face;
        } },
        ImageSegmenter: { createFromOptions: async (_files, options) => {
          creations.push({ type: "person", options });
          const delegate = options.baseOptions.delegate; personCreationCount++;
          if (config.gpuError && delegate === "GPU") throw new Error("GPU allocation failed");
          if (config.cpuError && delegate === "CPU") throw new Error("CPU allocation failed");
          const task = { delegate, getLabels: () => config.labels || labels,
            segmentForVideo(bitmap, timestamp, callback) {
              executions.push({ bitmap, timestamp, delegate });
              assert(!this.closed, "Inference never reuses a closed task");
              if (delegate === "GPU" && config.gpuExecutionError && !config.gpuExecutionAfterCallback) throw new Error("GPU execution failed");
              if (delegate === "CPU" && config.cpuExecutionError) throw new Error("CPU execution failed");
              callback({ confidenceMasks: config.masks || validMasks() });
              this.callbacksReturned = (this.callbacksReturned || 0) + 1;
              if (delegate === "GPU" && config.gpuExecutionError) throw new Error("GPU execution failed after output");
            },
            close() { this.closed = true; this.closeCount = (this.closeCount || 0) + 1; } };
          tasks.push(task);
          if (remainingGates-- > 0 || config.gatedPersonCreations?.includes(personCreationCount)) await new Promise(resolve => gates.push(resolve));
          return task;
        } }
      });
    } });
  vm.runInContext(source, context, { filename: "meetinglens-worker.js" });
  let nextId = 1;
  return { messages, creations, tasks, gates, face, config, executions,
    async send(type, extra = {}) {
      const id = nextId++; await self.onmessage({ data: { id, type, ...extra } });
      const message = messages.find(item => item.id === id); assert(message, `${type} receives a protocol response`); return message;
    } };
}
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); reports.push({ name, pass: true, ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { reports.push({ name, pass: false, error: error.stack }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function analyze(w, timestamp = 100) {
  const bitmap = { closed: false, close() { this.closed = true; this.closeCount = (this.closeCount || 0) + 1; } };
  const response = await w.send("analyze", { bitmap, timestamp, options: { face: false } });
  assert.equal(bitmap.closeCount, 1, "The transferred camera bitmap is closed exactly once on every result"); return response;
}
async function run() {
  await check("Complete person union preserves hair, both skin classes, clothes and accessories", async () => {
    const w = worker(); const init = await w.send("init");
    assert(init.capabilities.segmentation); assert.match(init.capabilities.personModel, /multiclass/i);
    const result = await analyze(w);
    assert.equal(result.error, undefined); assert.equal(result.result.mask.width, 6);
    assert.deepEqual([...result.result.mask.pixels].filter((_, i) => i % 4 === 3), [255, 255, 255, 255, 255, 0]);
    assert.equal(result.transferCount, 1, "The complete alpha mask is returned through the transfer protocol");
    const person = w.creations.find(item => item.type === "person");
    assert.match(person.options.baseOptions.modelAssetPath, /person_segmenter_multiclass\.tflite$/);
    const edges = worker({ masks: validMasks([0, .1, .5, .9, 1]) }); await edges.send("init");
    assert.deepEqual([...(await analyze(edges)).result.mask.pixels].filter((_, i) => i % 4 === 3), [255, 255, 128, 0, 0], "Union alpha retains the established endpoint calibration");
  });

  await check("Hardware GPU failure retries the same quality model on CPU and face failure leaves person effects usable", async () => {
    const w = worker({ gpuError: true, faceError: true }); const init = await w.send("init");
    assert.equal(init.capabilities.face, false); assert.equal(init.capabilities.segmentation, true);
    assert.equal(init.capabilities.segmentationDelegate, "CPU"); assert.equal(init.capabilities.analysisIntervalMs, 125);
    const attempts = w.creations.filter(item => item.type === "person");
    assert.deepEqual(attempts.map(item => item.options.baseOptions.delegate), ["GPU", "CPU"]);
    assert.equal(attempts[0].options.baseOptions.modelAssetPath, attempts[1].options.baseOptions.modelAssetPath);
    assert((await analyze(w)).result.mask, "A missing face model never disables a usable complete-person model");
  });

  await check("A GPU execution failure retries the same frame and model on CPU and keeps CPU for later frames", async () => {
    for (const gpuExecutionAfterCallback of [false, true]) {
      const w = worker({ gpuExecutionError: true, gpuExecutionAfterCallback });
      assert.equal((await w.send("init")).capabilities.segmentationDelegate, "GPU");
      const result = await analyze(w, 731);
      assert.equal(result.error, undefined); assert(result.result.mask);
      assert.equal(result.result.timestamp, 731);
      assert.equal(result.capabilities.segmentationDelegate, "CPU");
      assert.equal(result.capabilities.backend, "CPU/WASM worker");
      assert.equal(result.capabilities.analysisIntervalMs, 125);
      assert.equal(result.capabilities.face, true);
      const attempts = w.creations.filter(item => item.type === "person");
      assert.deepEqual(attempts.map(item => item.options.baseOptions.delegate), ["GPU", "CPU"]);
      assert.equal(attempts[0].options.baseOptions.modelAssetPath, attempts[1].options.baseOptions.modelAssetPath);
      assert.deepEqual(w.executions.map(item => item.delegate), ["GPU", "CPU"]);
      assert.equal(w.executions[0].bitmap, w.executions[1].bitmap, "Recovery retries the identical bitmap, including when the GPU produced partial output");
      assert.equal(w.executions[0].timestamp, w.executions[1].timestamp);
      assert(w.tasks[0].closed); assert.equal(w.tasks[0].closeCount, 1);
      assert(!w.tasks[1].closed); assert(!w.face.closed);
      assert.equal(result.transferCount, 1, "Only the successful CPU mask is published");
      assert((await analyze(w, 740)).result.mask);
      assert.deepEqual(w.executions.map(item => item.delegate), ["GPU", "CPU", "CPU"]);
      assert.equal(w.creations.filter(item => item.type === "person").length, 2);
    }
  });

  await check("Failed CPU recovery releases both person tasks and reports unavailable segmentation while keeping face tracking", async () => {
    for (const failure of [{ cpuError: true }, { cpuExecutionError: true }]) {
      const w = worker({ gpuExecutionError: true, ...failure }); await w.send("init");
      const response = await analyze(w);
      assert.match(response.error, /CPU.*failed/i); assert.equal(response.result, undefined);
      assert.equal(response.capabilities.segmentation, false);
      assert.equal(response.capabilities.face, true);
      assert.equal(response.capabilities.segmentationDelegate, "CPU");
      assert.equal(response.capabilities.personModel, null);
      assert(w.tasks.every(task => task.closed)); assert(!w.face.closed);
      assert.equal(response.transferCount, 0, "A partial failed inference never transfers a mask");
      const subsequent = await analyze(w, 110);
      assert.equal(subsequent.result.mask, null);
      assert.equal(w.creations.filter(item => item.type === "person").length, 2, "A failed fallback does not repeatedly allocate new tasks per frame");
    }
  });

  await check("Software or private renderer information stays on CPU while a known hardware renderer enables GPU", async () => {
    for (const config of [{ renderer: "ANGLE (Google, Vulkan SwiftShader Device)" }, { renderer: "llvmpipe (LLVM)" },
      { renderer: "Microsoft Basic Render Driver" }, { renderer: "Unknown device" }, { privateRenderer: true }]) {
      const w = worker(config); const init = await w.send("init");
      assert.equal(init.capabilities.segmentationDelegate, "CPU");
      assert.deepEqual(w.creations.filter(item => item.type === "person").map(item => item.options.baseOptions.delegate), ["CPU"]);
      assert(!JSON.stringify(init.capabilities).includes(config.renderer || "UNMASKED_RENDERER"), "Renderer identifiers are not published in capabilities");
    }
    const hardware = worker(); const init = await hardware.send("init");
    assert.equal(init.capabilities.segmentationDelegate, "GPU"); assert.equal(init.capabilities.analysisIntervalMs, 33);
    assert.equal(hardware.creations.find(item => item.type === "face").options.baseOptions.delegate, "CPU");
  });

  await check("Malformed class layouts and nonfinite confidence values fail without publishing a partial person mask", async () => {
    const wrongSize = validMasks(); wrongSize[2] = { ...wrongSize[2], width: 7 };
    const wrongData = validMasks(); wrongData[0] = { ...wrongData[0], getAsFloat32Array: () => new Float32Array(2) };
    for (const masks of [validMasks().slice(0, 5), wrongSize, wrongData, validMasks([0, NaN, 1]), validMasks([0, Infinity, 1])]) {
      const w = worker({ masks }); await w.send("init"); const result = await analyze(w);
      assert.match(result.error, /invalid|six-class/i); assert.equal(result.result, undefined);
      assert.equal(w.creations.filter(item => item.type === "person").length, 1, "Invalid confidence output never triggers a delegate fallback");
      assert.equal(w.tasks[0].callbacksReturned, 1, "Validation does not interrupt MediaPipe's callback cleanup");
    }
    const w = worker({ labels: ["person", "background"] }); const init = await w.send("init");
    assert(init.capabilities.face); assert.equal(init.capabilities.segmentation, false);
    assert.equal(init.capabilities.personModel, null); assert(w.tasks.every(task => task.closed), "Rejected task instances release their resources");
  });

  await check("Dispose during initialization cancels the old tasks and allows a clean new model initialization", async () => {
    const w = worker({ gatedCreations: 1 }); const pending = w.send("init");
    for (let i = 0; i < 20 && !w.gates.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.gates.length, 1); assert((await w.send("dispose")).disposed);
    w.gates.shift()(); const discarded = await pending;
    assert.match(discarded.error, /cancelled/i); assert(w.tasks[0].closed);
    const fresh = await w.send("init"); assert(fresh.capabilities.segmentation);
    assert((await analyze(w, 20)).result.mask, "The new worker state accepts analysis after the cancelled initialization");
  });

  await check("Dispose during GPU recovery closes the obsolete CPU task without publishing old pixels or capabilities", async () => {
    const w = worker({ gpuExecutionError: true, gatedPersonCreations: [2] }); await w.send("init");
    const pending = analyze(w, 700);
    for (let i = 0; i < 20 && !w.gates.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.gates.length, 1); assert(w.tasks[0].closed);
    assert((await w.send("dispose")).disposed);
    w.config.gpuExecutionError = false;
    const fresh = await w.send("init");
    assert.equal(fresh.capabilities.segmentationDelegate, "GPU");
    const newTask = w.tasks[2]; assert(newTask && !newTask.closed);
    w.gates.shift()(); const cancelled = await pending;
    assert.match(cancelled.error, /cancelled/i);
    assert.equal(cancelled.result, undefined); assert.equal(cancelled.capabilities, undefined);
    assert(w.tasks[1].closed, "The delayed obsolete CPU allocation is released");
    assert.equal(w.tasks[1].closeCount, 1); assert(!newTask.closed);
    const response = await analyze(w, 20);
    assert(response.result.mask); assert.equal(w.executions.at(-1).delegate, "GPU");
  });
}
run().catch(error => { reports.push({ name: "runner", pass: false, error: error.stack }); }).finally(() => {
  const reportPath = process.env.PERSON_WORKER_REPORT || path.join(root, ".qa/person-worker-verification.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: "Deterministic worker protocol doubles; no user image", checks: reports }, null, 2));
  const failed = reports.filter(item => !item.pass); console.log(`${reports.length - failed.length}/${reports.length} person worker protocol checks passed`); process.exitCode = failed.length ? 1 : 0;
});
