import { Camera, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { scanTokenFrom } from '../lib/vouchers';
import { Alert, Button, Modal } from './ui';

/** The browser's own QR reader (Chrome on Android, among others). Not in every browser. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorClass = new (opts: { formats: string[] }) => BarcodeDetectorLike;
const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;

/** Scanning is for phones and tablets: a touch screen with a camera on the back. */
const onPhone = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Scan a voucher slip's QR code with the phone's camera. Where the browser can't read QR
 * codes itself, the phone's camera app does it: the code is a link that opens this page.
 * On a computer, nothing is shown; the code is typed.
 */
export function VoucherScanner({ onScan }: { onScan: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!onPhone()) return null;
  if (!Detector) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 ring-1 ring-zinc-950/5">
        <Camera className="mt-0.5 size-4 shrink-0" aria-hidden />
        To scan a slip, point this phone's camera app at its QR code and open the link.
      </p>
    );
  }
  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        <ScanLine aria-hidden /> Scan the voucher's QR code
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Scan the voucher">
        {open && (
          <Viewfinder
            onScan={(token) => {
              setOpen(false);
              onScan(token);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function Viewfinder({ onScan }: { onScan: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notVoucher, setNotVoucher] = useState(false);
  // The latest callback, without restarting the camera when the page re-renders.
  const report = useRef(onScan);
  useEffect(() => {
    report.current = onScan;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detector = new Detector!({ formats: ['qr_code'] });

    const look = async () => {
      if (stopped || !video.current) return;
      try {
        const found = await detector.detect(video.current);
        for (const code of found) {
          const token = scanTokenFrom(code.rawValue);
          if (token) {
            stopped = true;
            report.current(token);
            return;
          }
          setNotVoucher(true);
        }
      } catch {
        // A frame that couldn't be read; try the next one.
      }
      timer = setTimeout(look, 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        stream = s;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        void look();
      })
      .catch(() =>
        setError(
          "The camera couldn't be opened. Allow camera access for this site, or type the code.",
        ),
      );

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
            <div
              className="pointer-events-none absolute inset-10 rounded-2xl ring-2 ring-white/80"
              aria-hidden
            />
          </div>
          <p className="text-sm text-zinc-600">
            Hold the slip's QR code inside the square. It reads by itself.
          </p>
          {notVoucher && <Alert tone="warning">That QR code isn't an Agrowth voucher slip.</Alert>}
        </>
      )}
    </div>
  );
}
