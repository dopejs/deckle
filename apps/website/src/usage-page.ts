import usageMarkdown from "../../../docs/usage.md?raw";
import { renderDocPage } from "./doc-page.js";

void renderDocPage(usageMarkdown, { root: "../../", active: "usage", title: "Usage" });
