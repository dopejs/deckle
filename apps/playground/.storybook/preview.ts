import type { Preview } from "@storybook/html-vite";

const preview: Preview = {
  parameters: {
    layout: "centered",
    options: {
      storySort: {
        order: [
          "Canvas Stream",
          "Streaming",
          "Infinite Canvas",
          "Hit Testing",
          "Sanitizer",
          "LOD & Texture Cache",
        ],
      },
    },
  },
};

export default preview;
