import { renderHeader } from "./header.js";
import { mountHeroCanvas } from "./hero-canvas.js";

const PACKAGES: readonly { name: string; role: string }[] = [
  { name: "canvas-core", role: "camera, scene store transactions, lifecycle, visibility, budgets" },
  { name: "canvas-spatial", role: "grid spatial index plus the naive differential oracle" },
  { name: "canvas-artifact", role: "revisions, interaction tree, canonical serialization" },
  { name: "canvas-security", role: "static-profile sanitizer, URL policy, quotas, capabilities" },
  { name: "canvas-runtime", role: "runtime message protocol, epochs, capability-guarded bridge" },
  { name: "canvas-renderer", role: "retained pictures, compositor, LOD, texture budget" },
  { name: "canvas-editor", role: "internal hit testing, selection model, virtual event paths" },
  { name: "canvas-protocol", role: "shared pre-release vocabulary" },
  { name: "canvas-platform-probe", role: "HTML-in-Canvas capability probes, evidence manifests" },
];

const header = document.getElementById("header");
if (header) renderHeader(header, { root: "./", active: "overview" });

const grid = document.getElementById("package-grid");
if (grid) {
  grid.innerHTML = PACKAGES.map(
    (pkg) => `
      <article class="package">
        <h3 class="package__name">@dopejs/${pkg.name}</h3>
        <p class="package__role">${pkg.role}</p>
      </article>`,
  ).join("");
}

const canvas = document.getElementById("hero-canvas");
if (canvas instanceof HTMLCanvasElement) {
  mountHeroCanvas(canvas, document.getElementById("hero-coord"));
}
