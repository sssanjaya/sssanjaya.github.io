// Files on the 3D monitor's desktop. Shared by the HTML desktop
// (DeskOS.astro) and the canvas copy of it that the scene draws on the
// screen while the camera is pulled back (rack.ts), so the two match.
export const deskFiles = [
  { id: "about", name: "about.txt", kind: "txt" },
  { id: "experience", name: "experience", kind: "dir" },
  { id: "stack", name: "stack.yaml", kind: "code" },
  { id: "signals", name: "signals.json", kind: "chart" },
  { id: "rules", name: "house-rules.md", kind: "txt" },
  { id: "contact", name: "contact.vcf", kind: "card" },
  { id: "terminal", name: "Terminal", kind: "term" },
] as const;

// What sits in the dock, left to right.
export const dockFiles = ["experience", "about", "signals", "terminal", "contact"] as const;

// The desktop is drawn at this size and scaled to the screen.
export const DESK_W = 1024;
export const DESK_H = 595;
