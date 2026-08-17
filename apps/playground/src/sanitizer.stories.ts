import { sanitizeHtml } from "@dopejs/canvas-security";

export default {
  title: "Sanitizer",
};

const SAMPLES: Record<string, string> = {
  "benign card":
    '<section class="card" style="padding: 12px">' +
    "<h2>Quarterly report</h2><p>Revenue is <strong>up 12%</strong>.</p>" +
    '<a href="https://example.com/report">Details</a></section>',
  "script injection":
    '<div><script>document.cookie</script><p onclick="alert(1)">click me</p></div>',
  "hostile urls": '<a href="javascript:alert(1)">x</a><img src="//evil.example/pixel.png">',
  "style exfiltration": '<div style="background:url(https://evil.example/steal)">text</div>',
  "attribute smuggling": '<img src="x" alt="quote"onerror="alert(1)">',
  "deep nesting bomb": "<div>".repeat(100) + "boom" + "</div>".repeat(100),
};

/**
 * The static-profile sanitizer re-serializes output from allowlisted parts
 * only and fails closed on anything it cannot positively parse. The right
 * pane renders the sanitized result inside a shadow root; diagnostics list
 * everything that was dropped and why.
 */
export const Static_Profile = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 13px system-ui; width: 860px;";

  const picker = document.createElement("select");
  for (const name of Object.keys(SAMPLES)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    picker.append(option);
  }
  const input = document.createElement("textarea");
  input.style.cssText =
    "width: 100%; height: 120px; font: 12px ui-monospace, monospace; margin: 8px 0; box-sizing: border-box;";
  input.value = SAMPLES["benign card"] as string;

  const row = document.createElement("div");
  row.style.cssText = "display: flex; gap: 12px;";
  const outputPane = document.createElement("div");
  outputPane.style.cssText =
    "flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 10px; min-height: 140px;";
  const detailPane = document.createElement("pre");
  detailPane.style.cssText =
    "flex: 1; background: #f6f6f6; border-radius: 6px; padding: 10px; min-height: 140px; " +
    "white-space: pre-wrap; word-break: break-all; margin: 0;";
  row.append(outputPane, detailPane);

  const shadow = outputPane.attachShadow({ mode: "open" });

  const run = (): void => {
    const result = sanitizeHtml(input.value);
    if (result.ok) {
      shadow.innerHTML = result.html;
      detailPane.textContent =
        `ok — ${result.elementCount} elements\n\nsanitized html:\n${result.html}\n\n` +
        `diagnostics (${result.diagnostics.length}):\n` +
        result.diagnostics.map((d) => `- ${d.code}: ${d.detail}`).join("\n");
    } else {
      shadow.innerHTML = "";
      const violation = result.violation
        ? `\nquota: ${result.violation.quota} actual=${result.violation.actual} limit=${result.violation.limit}`
        : "";
      detailPane.textContent = `REJECTED (${result.reason})\n${result.detail}${violation}`;
    }
  };

  picker.addEventListener("change", () => {
    input.value = SAMPLES[picker.value] as string;
    run();
  });
  input.addEventListener("input", run);

  root.append(picker, input, row);
  run();
  return root;
};
