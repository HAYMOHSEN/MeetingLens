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
function headMasks({ width = 64, height = 36, face = { x: 28, y: 8, width: 8, height: 10 }, otherFaces = [], background = 0.02 } = {}) {
  const data = labels.map(() => new Float32Array(width * height)); data[0].fill(background);
  for (const region of [face, ...otherFaces].filter(Boolean)) for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    data[3][y * width + x] = 0.95; data[0][y * width + x] = 0.02;
  }
  return data.map(confidence => ({ width, height, getAsFloat32Array: () => confidence }));
}
function worker(config = {}) {
  const messages = [], creations = [], tasks = [], gates = [], executions = [], crops = [], cropGates = [];
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
  const context = vm.createContext({ self, URL, performance: config.performance || performance, Uint8ClampedArray, Float32Array,
    OffscreenCanvas: class { getContext() { return config.noWebGL ? null : gl; } },
    async createImageBitmap(bitmap, x, y, width, height) {
      if (config.cropError) throw new Error("Crop allocation failed");
      const crop = { source: bitmap, x, y, width, height, isCrop: true,
        close() { this.closed = true; this.closeCount = (this.closeCount || 0) + 1; } };
      crops.push(crop);
      if (config.gatedCrop) await new Promise(resolve => cropGates.push(resolve));
      return crop;
    },
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
              if (bitmap.isCrop && config.cropExecutionError) throw new Error("Optional crop inference failed");
              if (delegate === "GPU" && config.gpuExecutionError && !config.gpuExecutionAfterCallback) throw new Error("GPU execution failed");
              if (delegate === "CPU" && config.cpuExecutionError) throw new Error("CPU execution failed");
              callback({ confidenceMasks: config.masksForFrame?.(bitmap, executions.length) || config.masks || validMasks() });
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
  return { messages, creations, tasks, gates, face, config, executions, crops, cropGates,
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
async function analyze(w, timestamp = 100, options = {}) {
  const bitmap = { width: 640, height: 360, closed: false, close() { this.closed = true; this.closeCount = (this.closeCount || 0) + 1; } };
  const response = await w.send("analyze", { bitmap, timestamp, options: { face: false, ...options } });
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

  await check("Head detail is opt-in and skips missing, tiny, oversized or nearby second faces", async () => {
    const cases = [
      { masks: headMasks(), enabled: false },
      { masks: headMasks({ face: null }), enabled: true },
      { masks: headMasks({ face: { x: 28, y: 8, width: 1, height: 8 } }), enabled: true },
      { masks: headMasks({ face: { x: 20, y: 8, width: 24, height: 24 } }), enabled: true },
      { masks: headMasks({ otherFaces: [{ x: 40, y: 8, width: 5, height: 7 }] }), enabled: true }
    ];
    for (const item of cases) {
      const w = worker({ masks: item.masks }); await w.send("init");
      const response = await analyze(w, 100, { headDetail: item.enabled });
      assert.equal(response.error, undefined); assert(response.result.mask);
      assert.equal(w.crops.length, 0); assert.equal(w.executions.length, 1);
      assert.equal(response.result.headDetail?.applied, item.enabled ? false : undefined);
    }
    const w = worker({ masks: headMasks() }); await w.send("init");
    const response = await analyze(w, 100, { headDetail: true, segmentation: false });
    assert.equal(response.result.mask, null); assert.equal(w.crops.length, 0); assert.equal(w.executions.length, 0);
  });

  await check("Head crop uses same-frame semantic face geometry and preserves the frame timestamp", async () => {
    const detail = headMasks({ face: { x: 21, y: 14, width: 22, height: 18 }, background: 1 });
    const w = worker({ faceError: true, masksForFrame: bitmap => bitmap.isCrop ? detail : headMasks() }); await w.send("init");
    const response = await analyze(w, 100, { headDetail: true });
    assert.equal(response.result.headDetail.applied, true);
    assert.equal(response.result.timestamp, 100, "A crop's internal task timestamp never replaces its source frame identifier");
    const crop = w.crops[0];
    assert.deepEqual([crop.x, crop.y, crop.width, crop.height], [208, 2, 224, 200]);
    assert.equal(crop.source, w.executions[0].bitmap); assert.equal(w.executions[1].bitmap, crop);
    assert.deepEqual(w.executions.map(item => item.timestamp), [100, 101]);
    assert.equal(crop.closeCount, 1); assert.equal(response.result.mask.headRegion, undefined, "Semantic work data stays inside the worker");
    const next = await analyze(w, 101, { headDetail: true });
    assert.equal(next.result.timestamp, 101);
    assert.deepEqual(w.executions.map(item => item.timestamp), [100, 101, 102, 103], "Subsequent VIDEO requests remain strictly increasing after a crop");
    assert(w.crops.every(item => item.closeCount === 1)); assert(w.tasks.every(task => !task.closed));
  });

  await check("Head detail blends a local semantic correction while every byte outside its crop stays intact", async () => {
    const full = headMasks(), detail = headMasks({ face: { x: 21, y: 14, width: 22, height: 18 }, background: 1 });
    const baselineWorker = worker({ masks: full }); await baselineWorker.send("init");
    const baseline = (await analyze(baselineWorker)).result.mask;
    const w = worker({ masksForFrame: bitmap => bitmap.isCrop ? detail : full }); await w.send("init");
    const response = await analyze(w, 100, { headDetail: true }), mask = response.result.mask, crop = w.crops[0];
    assert(response.result.headDetail.applied);
    let outside = 0, insideChanged = 0, partial = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const sx = (x + 0.5) * 640 / mask.width, sy = (y + 0.5) * 360 / mask.height, i = (y * mask.width + x) * 4;
      if (sx <= crop.x || sx >= crop.x + crop.width || sy <= crop.y || sy >= crop.y + crop.height) {
        for (let c = 0; c < 4; c++) assert.equal(mask.pixels[i + c], baseline.pixels[i + c], `Unchanged body/outside pixel ${x},${y},${c}`);
        outside++;
      } else {
        if (mask.pixels[i + 3] !== baseline.pixels[i + 3]) insideChanged++;
        if (mask.pixels[i + 3] > 0 && mask.pixels[i + 3] < 255) partial++;
      }
    }
    assert(outside > 1000 && insideChanged > 100 && partial > 0, "Correction stays local with a gradual overlap");
    assert.equal(mask.pixels[(13 * 64 + 32) * 4 + 3], 255, "Detected face remains opaque");
    assert.equal(mask.pixels[(8 * 64 + 40) * 4 + 3], 0, "Crop semantic background replaces a false foreground patch");
    assert.equal(mask.pixels[(30 * 64 + 32) * 4 + 3], 255, "Torso below the crop remains opaque");
    assert.equal(response.transferCount, 1);
  });

  await check("Head crop clamps at frame edges and leaves a distant second face untouched", async () => {
    const edge = worker({ masksForFrame: bitmap => bitmap.isCrop ? headMasks({ face: null }) : headMasks({ face: { x: 1, y: 2, width: 8, height: 10 } }) });
    await edge.send("init"); const response = await analyze(edge, 100, { headDetail: true });
    assert.equal(response.error, undefined); assert.equal(edge.crops.length, 1);
    assert.deepEqual([edge.crops[0].x, edge.crops[0].y, edge.crops[0].width, edge.crops[0].height], [0, 0, 162, 142]);
    const full = headMasks({ otherFaces: [{ x: 52, y: 8, width: 5, height: 7 }] });
    const w = worker({ masksForFrame: bitmap => bitmap.isCrop ? headMasks({ face: { x: 21, y: 14, width: 22, height: 18 }, background: 1 }) : full });
    await w.send("init"); const refined = await analyze(w, 100, { headDetail: true });
    assert(refined.result.headDetail.applied);
    assert.equal(refined.result.mask.pixels[(10 * 64 + 54) * 4 + 3], 255, "Distant second face remains the full-frame prediction");
  });

  await check("Optional crop allocation, inference, validation or missing face failures retain the complete valid base mask", async () => {
    const broken = headMasks(); broken[0] = { ...broken[0], getAsFloat32Array: () => new Float32Array(2) };
    for (const config of [
      { cropError: true }, { cropExecutionError: true },
      { cropMasks: broken }, { cropMasks: headMasks({ face: null, background: 1 }) }
    ]) {
      const w = worker({ ...config, masksForFrame: bitmap => bitmap.isCrop ? config.cropMasks || headMasks() : headMasks() });
      await w.send("init"); const response = await analyze(w, 100, { headDetail: true });
      assert.equal(response.error, undefined); assert.equal(response.result.headDetail.applied, false);
      assert(response.result.mask.pixels.every((value, i) => i % 4 !== 3 || value === 255));
      assert.equal(response.result.timestamp, 100); assert.equal(response.transferCount, 1);
      assert.equal(w.creations.filter(item => item.type === "person").length, 1, "An optional failure does not tear down the base delegate");
      assert(w.tasks.every(task => !task.closed)); assert(w.crops.every(crop => crop.closeCount === 1));
    }
  });

  await check("Head detail runs on the recovered CPU task after a full-frame GPU failure", async () => {
    const w = worker({ gpuExecutionError: true, masksForFrame: bitmap => bitmap.isCrop ? headMasks({ face: { x: 21, y: 14, width: 22, height: 18 }, background: 1 }) : headMasks() });
    await w.send("init"); const response = await analyze(w, 100, { headDetail: true });
    assert.equal(response.error, undefined); assert(response.result.headDetail.applied);
    assert.equal(response.capabilities.segmentationDelegate, "CPU"); assert.equal(response.result.timestamp, 100);
    assert.deepEqual(w.executions.map(item => [item.delegate, item.timestamp]), [["GPU", 100], ["CPU", 100], ["CPU", 101]]);
    assert.equal(w.executions[0].bitmap, w.executions[1].bitmap); assert(w.tasks[0].closed); assert(!w.tasks[1].closed);
    assert.equal(w.crops[0].closeCount, 1);
  });

  await check("Slow full-frame analysis keeps its usable mask without starting an extra head inference", async () => {
    let clock = 100;
    const w = worker({ performance: { now: () => clock }, masksForFrame: bitmap => { if (!bitmap.isCrop) clock += 6001; return headMasks(); } });
    await w.send("init"); const response = await analyze(w, 100, { headDetail: true });
    assert.equal(response.error, undefined); assert.equal(response.result.timestamp, 100);
    assert.equal(response.result.headDetail.applied, false); assert.equal(response.result.headDetail.reason, "frame-budget");
    assert.equal(w.crops.length, 0); assert.equal(w.executions.length, 1); assert.equal(response.result.inferenceMs, 6001);
    assert(response.result.mask.pixels.every((value, i) => i % 4 !== 3 || value === 255));
  });

  await check("Optional face-component analysis stays bounded for an unexpectedly large model mask", async () => {
    let faceReads = 0;
    const background = new Float32Array(1025 * 1024);
    const masks = labels.map((_, i) => ({ width: 1025, height: 1024, getAsFloat32Array() {
      if (i === 0) return background;
      faceReads++; throw new Error("Optional large face buffer must not be read");
    } }));
    const w = worker({ masks }); await w.send("init");
    const response = await analyze(w, 100, { headDetail: true });
    assert.equal(response.error, undefined); assert.equal(response.result.mask.width, 1025);
    assert.equal(faceReads, 0); assert.equal(w.crops.length, 0); assert.equal(response.result.headDetail.applied, false);
  });

  await check("Dispose while a head crop is pending prevents old pixels and closes the crop without touching a new task", async () => {
    const w = worker({ gatedCrop: true, masksForFrame: bitmap => bitmap.isCrop ? headMasks({ face: { x: 21, y: 14, width: 22, height: 18 }, background: 1 }) : headMasks() });
    await w.send("init"); const pending = analyze(w, 100, { headDetail: true });
    for (let i = 0; i < 20 && !w.cropGates.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.cropGates.length, 1); assert.equal(w.executions.length, 1);
    await w.send("dispose"); w.config.gatedCrop = false; await w.send("init");
    const newTask = w.tasks[1]; assert(newTask && !newTask.closed);
    w.cropGates.shift()(); const cancelled = await pending;
    assert.match(cancelled.error, /cancelled/i); assert.equal(cancelled.result, undefined); assert.equal(cancelled.capabilities, undefined);
    assert.equal(w.crops[0].closeCount, 1); assert.equal(w.executions.length, 1, "Obsolete crop never infers on a closed or replaced task");
    assert(!newTask.closed); const fresh = await analyze(w, 20, { headDetail: true });
    assert(fresh.result.headDetail.applied); assert(!newTask.closed); assert.equal(fresh.result.timestamp, 20);
  });
}
run().catch(error => { reports.push({ name: "runner", pass: false, error: error.stack }); }).finally(() => {
  const reportPath = process.env.PERSON_WORKER_REPORT || path.join(root, ".qa/person-worker-verification.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), fixture: "Deterministic worker protocol doubles; no user image", checks: reports }, null, 2));
  const failed = reports.filter(item => !item.pass); console.log(`${reports.length - failed.length}/${reports.length} person worker protocol checks passed`); process.exitCode = failed.length ? 1 : 0;
});
