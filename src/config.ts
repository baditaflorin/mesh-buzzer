import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-buzzer",
  breadcrumbs: false,
  description: "Quiz-show buzzer — mesh clock arbitrates who hit first to the millisecond",
  accentHex: "#7d40ff",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
