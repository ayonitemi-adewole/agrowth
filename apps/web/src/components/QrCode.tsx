import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code as SVG: sharp at any size and in print. Medium error correction, so a slip
 * that's creased or smudged still scans. Includes the quiet zone scanners need.
 */
export function QrCode({
  value,
  size = 120,
  label,
  className,
}: {
  value: string;
  size?: number;
  label: string;
  className?: string;
}) {
  const { path, cells } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
      }
    }
    return { path: d, cells: n + 8 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${cells} ${cells}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={cells} height={cells} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
