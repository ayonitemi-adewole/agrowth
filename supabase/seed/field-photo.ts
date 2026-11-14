/**
 * A stand-in for a field agent's photo: an illustrated field at the right stage of the
 * season, with the GPS stamp a real visit photo would carry. Labelled as a demo image.
 */
export type FieldStage = 'soil' | 'green' | 'golden';

const GROUND: Record<FieldStage, [string, string, string]> = {
  soil: ['#7a4e31', '#a8734c', '#5f3b24'],
  green: ['#3f6d22', '#77a843', '#2f5418'],
  golden: ['#a07c25', '#d9b95c', '#7d5f17'],
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fieldPhoto(opts: {
  stage: FieldStage;
  title: string;
  lat: number;
  lon: number;
  accuracy: number;
  takenAt: Date;
  variant: number;
}): Uint8Array {
  const { stage, lat, lon, accuracy, takenAt, variant } = opts;
  const [far, near, row] = GROUND[stage];
  const horizon = 330 + (variant % 5) * 12;

  // Crop rows converging on a vanishing point on the horizon.
  const vx = 420 + (variant % 7) * 60;
  const rows: string[] = [];
  for (let i = -14; i <= 14; i++) {
    const x = vx + i * 130;
    rows.push(
      `<path d="M${vx + i * 6} ${horizon} L${x} 900" stroke="${row}" stroke-width="${stage === 'soil' ? 5 : 11}" stroke-linecap="round" opacity="0.75"/>`,
    );
  }

  // A treeline of overlapping crowns along the horizon.
  const trees: string[] = [];
  for (let i = 0; i < 18; i++) {
    const x = ((i * 97 + variant * 53) % 1300) - 50;
    const r = 26 + ((i * 31 + variant * 7) % 30);
    trees.push(
      `<circle cx="${x}" cy="${horizon - r * 0.55}" r="${r}" fill="#2d4a22" opacity="0.9"/>`,
    );
  }

  const stamp = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}  ·  ±${accuracy} m  ·  ${takenAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fc3ea"/><stop offset="1" stop-color="#e9f3f8"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${far}"/><stop offset="1" stop-color="${near}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="${horizon + 2}" fill="url(#sky)"/>
  <circle cx="${980 - (variant % 4) * 120}" cy="120" r="46" fill="#fff6d5" opacity="0.9"/>
  ${trees.join('\n  ')}
  <rect y="${horizon}" width="1200" height="${900 - horizon}" fill="url(#ground)"/>
  ${rows.join('\n  ')}
  <rect y="790" width="1200" height="110" fill="#000" opacity="0.55"/>
  <text x="32" y="836" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="600" fill="#fff">${escape(opts.title)}</text>
  <text x="32" y="874" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" fill="#e5e7eb">${escape(stamp)}</text>
  <text x="1168" y="836" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600" letter-spacing="2" fill="#fde68a">DEMO IMAGE</text>
</svg>`;
  return new TextEncoder().encode(svg);
}

const SKIN = ['#8d5524', '#6b3e1f', '#a0662f', '#7a4a26', '#5c3317'];
const CLOTH = ['#1f6f50', '#b45309', '#1d4ed8', '#7c2d12', '#6d28d9', '#0f766e'];

/**
 * A stand-in for the farmer's portrait an agent takes at enrolment and at each visit: an
 * illustrated head-and-shoulders silhouette (not a real person), with the farmer's name,
 * the time and a GPS stamp when there is one. Labelled as a demo image.
 */
export function farmerPortrait(opts: {
  name: string;
  takenAt: Date;
  variant: number;
  lat?: number;
  lon?: number;
}): Uint8Array {
  const { name, takenAt, variant, lat, lon } = opts;
  const skin = SKIN[variant % SKIN.length];
  const cloth = CLOTH[(variant >> 2) % CLOTH.length];
  const wrap = variant % 2 === 0;
  const where =
    lat !== undefined && lon !== undefined
      ? `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}  ·  `
      : '';
  const stamp = `${where}${takenAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9e6d3"/><stop offset="1" stop-color="#9fbf8f"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <path d="M120 1200 C130 920 260 820 450 820 C640 820 770 920 780 1200 Z" fill="${cloth}"/>
  <rect x="395" y="660" width="110" height="190" rx="40" fill="${skin}"/>
  <ellipse cx="450" cy="520" rx="175" ry="215" fill="${skin}"/>
  ${
    wrap
      ? `<path d="M265 470 C270 300 630 300 635 470 C600 400 300 400 265 470 Z" fill="${cloth}"/>
  <path d="M600 380 C690 360 700 300 640 280 Z" fill="${cloth}"/>`
      : `<path d="M285 440 C300 320 600 320 615 440 C580 390 320 390 285 440 Z" fill="#1c1917"/>`
  }
  <rect y="1050" width="900" height="150" fill="#000" opacity="0.55"/>
  <text x="32" y="1104" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="600" fill="#fff">${escape(name)}</text>
  <text x="32" y="1150" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" fill="#e5e7eb">${escape(stamp)}</text>
  <text x="868" y="1104" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="600" letter-spacing="2" fill="#fde68a">DEMO IMAGE</text>
</svg>`;
  return new TextEncoder().encode(svg);
}
