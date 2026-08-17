import { renderHeader } from "./header.js";
import { mountHeroCanvas } from "./hero-canvas.js";
import { readPageI18n } from "./i18n.js";

const context = readPageI18n();

const header = document.getElementById("header");
if (header) renderHeader(header, context);

const canvas = document.getElementById("hero-canvas");
if (canvas instanceof HTMLCanvasElement) {
  mountHeroCanvas(canvas, document.getElementById("hero-coord"));
}
