/// <reference types="vite/client" />

// Vite raw asset imports (e.g. "./file.svg?raw")
declare module "*?raw" {
  const content: string;
  export default content;
}

// Some dependency builds may not ship TypeScript declarations (CI strict mode).
// We only need Luxon's runtime for date helpers in reports.
declare module "luxon";
