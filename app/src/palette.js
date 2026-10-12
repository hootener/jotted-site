// Six colors, each with a dark-canvas variant (the canonical value stored in
// strokes) and a light-canvas counterpart from the same family.
export const PALETTE = [
  { name: 'White', hex: '#FFFFFF', light: '#1A1A1E' },
  { name: 'Yellow', hex: '#FFE566', light: '#B8900A' },
  { name: 'Pink', hex: '#FF8AC2', light: '#D1327F' },
  { name: 'Green', hex: '#7CF29A', light: '#1E9A4C' },
  { name: 'Light blue', hex: '#7FD4FF', light: '#1C7FD6' },
  { name: 'Light purple', hex: '#C9A7FF', light: '#7A4BD1' },
];

export const THEMES = {
  dark: { bg: '#000000', paperLine: 'rgba(255, 255, 255, 0.07)', paperDot: 'rgba(255, 255, 255, 0.22)' },
  light: { bg: '#FFFFFF', paperLine: 'rgba(0, 0, 0, 0.09)', paperDot: 'rgba(0, 0, 0, 0.28)' },
};

const LIGHT_BY_HEX = new Map(PALETTE.map((c) => [c.hex.toUpperCase(), c.light]));

/** Map a stored (dark-canvas) stroke color to the color to draw for a theme. */
export function colorForTheme(hex, theme) {
  if (theme !== 'light') return hex;
  return LIGHT_BY_HEX.get(String(hex).toUpperCase()) ?? hex;
}
