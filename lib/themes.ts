// Color themes. The stylesheet expresses every brand color as an HSL value
// offset by --th (hue rotation) and scaled by --ts (saturation), so a theme is
// just those two numbers. Warning ambers, error reds, and the purple ELA
// accent are outside the rotated band and stay recognizable in every theme.
export type Theme = {
  id: string;
  name: string;
  description: string;
  hue: number;
  saturation: number;
};

export const themes: Theme[] = [
  { id: "pine", name: "Pine", description: "The original deep green.", hue: 0, saturation: 1 },
  { id: "forest", name: "Forest", description: "Richer, brighter greens.", hue: 0, saturation: 1.35 },
  { id: "teal", name: "Teal", description: "Cool green with a hint of blue.", hue: 30, saturation: 1.05 },
  { id: "ocean", name: "Ocean", description: "Calm navy and sky blue.", hue: 70, saturation: 1 },
  { id: "lavender", name: "Lavender", description: "Soft violet and lilac.", hue: 125, saturation: 0.95 },
  { id: "plum", name: "Plum", description: "Muted berry tones.", hue: 160, saturation: 0.8 },
  { id: "blossom", name: "Blossom", description: "Gentle rose and petal pink.", hue: 195, saturation: 0.85 },
  { id: "coral", name: "Coral", description: "Warm terracotta and peach.", hue: -115, saturation: 0.95 },
  { id: "honey", name: "Honey", description: "Golden, sunlit warmth.", hue: -100, saturation: 1 },
  { id: "slate", name: "Slate", description: "Quiet silver and graphite.", hue: 65, saturation: 0.18 },
];

export const defaultTheme = themes[0];

export function themeById(id?: string) {
  return themes.find((t) => t.id === id) || defaultTheme;
}
