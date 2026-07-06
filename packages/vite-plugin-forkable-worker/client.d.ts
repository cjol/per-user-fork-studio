// Reference from a consuming project's tsconfig via
//   "types": ["vite-plugin-forkable-worker/client"]
// to type the virtual seed module in the generated (or hand-written) entry.
declare module "virtual:forkable-worker/app" {
  const manifest: import("vite-plugin-forkable-worker/runtime").ForkableAppManifest;
  export default manifest;
}
