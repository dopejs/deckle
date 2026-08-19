import {
  ReferencePictureBackend,
  selectLod,
  selectSnapshotScale,
  TextureCache,
} from "@dopejs/deckle-renderer";

export default {
  title: "LOD & Texture Cache",
};

/** Zoom slider mapped through the LOD policy and snapshot resolution policy. */
export const Lod_Policy = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 13px system-ui; width: 520px;";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "-3";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = "-0.3";
  slider.style.width = "100%";
  const readout = document.createElement("pre");
  readout.style.cssText = "background: #f6f6f6; padding: 10px; border-radius: 6px;";

  const update = (): void => {
    const zoom = 10 ** Number(slider.value);
    const lod = selectLod(zoom);
    const scale = selectSnapshotScale(zoom, 2, 800, 600, 8192);
    readout.textContent =
      `zoom          ${zoom.toFixed(3)}\n` +
      `lod           ${lod}\n` +
      `snapshot px   ${Math.round(800 * scale)} × ${Math.round(600 * scale)} ` +
      `(scale ${scale.toFixed(3)} for an 800×600 artifact @ dpr 2)`;
  };
  slider.addEventListener("input", update);
  update();
  root.append(slider, readout);
  return root;
};

/**
 * Byte-budgeted cache with pin-aware LRU eviction. Add pictures, pin
 * artifacts, and watch admissions, evictions, and the leak-free byte total.
 */
export const Texture_Cache = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 13px system-ui; width: 560px;";
  const backend = new ReferencePictureBackend();
  const cache = new TextureCache(backend, { maxTotalBytes: 4_000_000, maxItemBytes: 1_500_000 });
  let counter = 0;
  const log: string[] = [];

  const controls = document.createElement("div");
  controls.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px;";
  const table = document.createElement("pre");
  table.style.cssText =
    "background: #f6f6f6; padding: 10px; border-radius: 6px; min-height: 180px;";

  const render = (): void => {
    const stats = cache.stats();
    table.textContent =
      `bytes ${stats.totalBytes.toLocaleString()} / 4,000,000   items ${stats.itemCount}\n` +
      `hits ${stats.hits}  misses ${stats.misses}  evictions ${stats.evictions}  ` +
      `admission rejects ${stats.admissionRejects}\n` +
      `backend live pictures ${backend.livePictureCount} (must equal items)\n\n` +
      log.slice(-10).join("\n");
  };

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement("button");
    element.textContent = label;
    element.addEventListener("click", () => {
      onClick();
      render();
    });
    return element;
  };

  controls.append(
    button("put 900KB picture", () => {
      const id = `artifact-${counter++}`;
      const decision = cache.put({
        artifactId: id,
        paintRevision: 1,
        widthPx: 600,
        heightPx: 400,
        resolutionScale: 1,
        byteEstimate: 900_000,
      });
      log.push(
        decision.admitted ? `put ${id}: admitted` : `put ${id}: rejected (${decision.reason})`,
      );
    }),
    button("put oversized 2MB", () => {
      const decision = cache.put({
        artifactId: `big-${counter++}`,
        paintRevision: 1,
        widthPx: 2000,
        heightPx: 2000,
        resolutionScale: 1,
        byteEstimate: 2_000_000,
      });
      log.push(`oversized: ${decision.admitted ? "admitted" : `rejected (${decision.reason})`}`);
    }),
    button("pin newest", () => {
      const id = `artifact-${counter - 1}`;
      cache.pin(id);
      log.push(`pinned ${id}`);
    }),
    button("clear", () => {
      cache.clear();
      log.push("cleared");
    }),
  );

  render();
  root.append(controls, table);
  return root;
};
