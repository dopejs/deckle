import { renderHeader } from "./header.js";

const header = document.getElementById("header");
if (header) renderHeader(header, { root: "../", active: "playground" });
