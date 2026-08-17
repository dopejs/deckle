import designMarkdown from "../../../docs/design.md?raw";
import { renderDocPage } from "./doc-page.js";

void renderDocPage(designMarkdown, { root: "../../", active: "design", title: "Design" });
