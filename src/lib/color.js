export const DEFAULT_ACCENT = '#0FA280';

export const ACCENT_PRESETS = [
  { name: 'Emerald', value: '#0FA280' },
  { name: 'Forest', value: '#15803D' },
  { name: 'Ocean', value: '#0284C7' },
  { name: 'Sky', value: '#38BDF8' },
  { name: 'Violet', value: '#7C3AED' },
  { name: 'Rose', value: '#E11D48' },
  { name: 'Harvest', value: '#F79009' },
  { name: 'Sun', value: '#FACC15' },
  { name: 'Slate', value: '#334155' },
];

const hexToRgb = (hex) => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

// Picks black or white text for a background colour using WCAG relative luminance
export const readableTextOn = (hex) => {
  try {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4 ? '#0b1210' : '#ffffff';
  } catch {
    return '#ffffff';
  }
};
