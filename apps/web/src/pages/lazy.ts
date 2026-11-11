import { lazy, type ComponentType } from 'react';
import { can } from '../lib/roles';
import type { Role } from '../lib/types';

/*
 * Screens load on demand, so the map library is only downloaded when a map is shown.
 * Each one can also be fetched ahead of time (`preloadRoute`): on hovering a menu item,
 * while the browser is idle, and behind the sign-in screen. By the time someone clicks,
 * the code is usually already here and the page opens without a pause.
 */

type Loader = () => Promise<unknown>;
const loaders = new Map<string, Loader>();

function page<K extends string>(
  route: string,
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
) {
  // One shared download, however many times it's asked for.
  let started: Promise<Record<K, ComponentType>> | undefined;
  const once = () => (started ??= load());
  loaders.set(route, once);
  return lazy(() => once().then((m) => ({ default: m[name] })));
}

export const CooperativesPage = page(
  'cooperatives',
  () => import('./CooperativesPage'),
  'CooperativesPage',
);
export const FarmersPage = page('farmers', () => import('./FarmersPage'), 'FarmersPage');
export const FarmerDetailPage = page(
  'farmers/:id',
  () => import('./FarmerDetailPage'),
  'FarmerDetailPage',
);
export const RegisterFarmerPage = page(
  'farmers/new',
  () => import('./RegisterFarmerPage'),
  'RegisterFarmerPage',
);
export const MapFarmPage = page('farmers/:id/map', () => import('./MapFarmPage'), 'MapFarmPage');
export const UsersPage = page('users', () => import('./UsersPage'), 'UsersPage');
export const CyclesPage = page('cycles', () => import('./CyclesPage'), 'CyclesPage');
export const CycleDetailPage = page(
  'cycles/:id',
  () => import('./cycle/CycleDetailPage'),
  'CycleDetailPage',
);
export const FieldWorkPage = page('field', () => import('./FieldWorkPage'), 'FieldWorkPage');
export const FieldVisitPage = page(
  'field/visit',
  () => import('./FieldVisitPage'),
  'FieldVisitPage',
);
export const LedgerPage = page('ledger', () => import('./LedgerPage'), 'LedgerPage');
export const VendorsPage = page('vendors', () => import('./VendorsPage'), 'VendorsPage');
export const RedeemPage = page('redeem', () => import('./RedeemPage'), 'RedeemPage');
export const BuyerPortalPage = page('buyer', () => import('./BuyerPortalPage'), 'BuyerPortalPage');
export const VoucherSlipsPage = page(
  'cycles/:id/vouchers/print',
  () => import('./VoucherSlipsPage'),
  'VoucherSlipsPage',
);
export const MarketplacePage = page(
  'invest',
  () => import('./invest/MarketplacePage'),
  'MarketplacePage',
);
export const ListingPage = page('invest/:id', () => import('./invest/ListingPage'), 'ListingPage');
export const PortfolioPage = page(
  'portfolio',
  () => import('./invest/PortfolioPage'),
  'PortfolioPage',
);
export const CertificatePage = page(
  'portfolio/:id/certificate',
  () => import('./invest/CertificatePage'),
  'CertificatePage',
);
export const SimulatedCheckoutPage = page(
  'pay/simulated',
  () => import('./invest/SimulatedCheckoutPage'),
  'SimulatedCheckoutPage',
);
export const InvestorProfilePage = page(
  'profile',
  () => import('./invest/InvestorProfilePage'),
  'InvestorProfilePage',
);
export const InvestorsPage = page('investors', () => import('./InvestorsPage'), 'InvestorsPage');
export const BankFilesPage = page('bank', () => import('./BankFilesPage'), 'BankFilesPage');
export const LandingPage = page('welcome', () => import('./LandingPage'), 'LandingPage');
export const ProgrammesPage = page(
  'programmes',
  () => import('./programme/ProgrammesPage'),
  'ProgrammesPage',
);
export const ProgrammeDetailPage = page(
  'programmes/:id',
  () => import('./programme/ProgrammeDetailPage'),
  'ProgrammeDetailPage',
);

/** The route pattern for a path: `/farmers/3f2a…/map` → `farmers/:id/map`. */
function patternOf(path: string): string {
  const parts = path.split(/[?#]/)[0]!.split('/').filter(Boolean);
  const exact = parts.join('/');
  if (loaders.has(exact)) return exact;
  // Anything that isn't a fixed segment of some route is an id.
  return parts
    .map((p, i) => (i > 0 && !/^(new|map|visit|vouchers|print|certificate)$/.test(p) ? ':id' : p))
    .join('/');
}

/** Starts downloading the screen at `path`, if it isn't here yet. Never throws. */
export function preloadRoute(path: string): Promise<void> {
  const load = loaders.get(patternOf(path));
  return load
    ? load().then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

/** Where each role lands after signing in. */
export function homePath(role?: Role): string {
  if (can.useStaffApp(role)) return '/';
  if (can.invest(role)) return '/invest';
  if (can.useBuyerPortal(role)) return '/buyer';
  return '/redeem';
}
