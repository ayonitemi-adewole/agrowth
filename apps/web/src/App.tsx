import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireStaff, RoleGate } from './components/Guards';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { Spinner } from './components/ui';
import { can } from './lib/roles';
import { isConfigured } from './lib/supabase';
import { AuthPage } from './pages/AuthPage';
import { OverviewPage } from './pages/OverviewPage';

// Pages load on demand, so the map library is only downloaded when a map is shown.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const CooperativesPage = page(() => import('./pages/CooperativesPage'), 'CooperativesPage');
const FarmersPage = page(() => import('./pages/FarmersPage'), 'FarmersPage');
const FarmerDetailPage = page(() => import('./pages/FarmerDetailPage'), 'FarmerDetailPage');
const RegisterFarmerPage = page(() => import('./pages/RegisterFarmerPage'), 'RegisterFarmerPage');
const MapFarmPage = page(() => import('./pages/MapFarmPage'), 'MapFarmPage');
const UsersPage = page(() => import('./pages/UsersPage'), 'UsersPage');
const CyclesPage = page(() => import('./pages/CyclesPage'), 'CyclesPage');
const CycleDetailPage = page(() => import('./pages/cycle/CycleDetailPage'), 'CycleDetailPage');
const FieldWorkPage = page(() => import('./pages/FieldWorkPage'), 'FieldWorkPage');
const FieldVisitPage = page(() => import('./pages/FieldVisitPage'), 'FieldVisitPage');
const LedgerPage = page(() => import('./pages/LedgerPage'), 'LedgerPage');
const VendorsPage = page(() => import('./pages/VendorsPage'), 'VendorsPage');
const RedeemPage = page(() => import('./pages/RedeemPage'), 'RedeemPage');
const VoucherSlipsPage = page(() => import('./pages/VoucherSlipsPage'), 'VoucherSlipsPage');
const MarketplacePage = page(() => import('./pages/invest/MarketplacePage'), 'MarketplacePage');
const ListingPage = page(() => import('./pages/invest/ListingPage'), 'ListingPage');
const PortfolioPage = page(() => import('./pages/invest/PortfolioPage'), 'PortfolioPage');
const CertificatePage = page(() => import('./pages/invest/CertificatePage'), 'CertificatePage');
const InvestorProfilePage = page(
  () => import('./pages/invest/InvestorProfilePage'),
  'InvestorProfilePage',
);
const InvestorsPage = page(() => import('./pages/InvestorsPage'), 'InvestorsPage');
const ProgrammesPage = page(() => import('./pages/programme/ProgrammesPage'), 'ProgrammesPage');
const ProgrammeDetailPage = page(
  () => import('./pages/programme/ProgrammeDetailPage'),
  'ProgrammeDetailPage',
);

export function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
              <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
              <Route element={<RequireStaff />}>
                <Route
                  path="cycles/:id/vouchers/print"
                  element={
                    <RoleGate allow={can.readCycles}>
                      <VoucherSlipsPage />
                    </RoleGate>
                  }
                />
                <Route
                  path="portfolio/:pledgeId/certificate"
                  element={
                    <RoleGate allow={can.invest}>
                      <CertificatePage />
                    </RoleGate>
                  }
                />
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route
                    path="invest"
                    element={
                      <RoleGate allow={can.invest}>
                        <MarketplacePage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="invest/:id"
                    element={
                      <RoleGate allow={can.viewListings}>
                        <ListingPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="portfolio"
                    element={
                      <RoleGate allow={can.invest}>
                        <PortfolioPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="profile"
                    element={
                      <RoleGate allow={can.invest}>
                        <InvestorProfilePage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="programmes"
                    element={
                      <RoleGate allow={can.readProgrammes}>
                        <ProgrammesPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="programmes/:id"
                    element={
                      <RoleGate allow={can.readProgrammes}>
                        <ProgrammeDetailPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="investors"
                    element={
                      <RoleGate allow={can.readInvestors}>
                        <InvestorsPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="vendors"
                    element={
                      <RoleGate allow={can.readVendors}>
                        <VendorsPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="redeem"
                    element={
                      <RoleGate allow={can.redeemVouchers}>
                        <RedeemPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="cooperatives"
                    element={
                      <RoleGate allow={can.readRegistry}>
                        <CooperativesPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="farmers"
                    element={
                      <RoleGate allow={can.readRegistry}>
                        <FarmersPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="farmers/new"
                    element={
                      <RoleGate allow={can.enrol}>
                        <RegisterFarmerPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="farmers/:id"
                    element={
                      <RoleGate allow={can.readRegistry}>
                        <FarmerDetailPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="farmers/:id/map"
                    element={
                      <RoleGate allow={can.enrol}>
                        <MapFarmPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="cycles"
                    element={
                      <RoleGate allow={can.readCycles}>
                        <CyclesPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="cycles/:id"
                    element={
                      <RoleGate allow={can.readCycles}>
                        <CycleDetailPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="field"
                    element={
                      <RoleGate allow={can.doFieldVisits}>
                        <FieldWorkPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="field/visit"
                    element={
                      <RoleGate allow={can.doFieldVisits}>
                        <FieldVisitPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="ledger"
                    element={
                      <RoleGate allow={can.readLedger}>
                        <LedgerPage />
                      </RoleGate>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <RoleGate allow={can.manageUsers}>
                        <UsersPage />
                      </RoleGate>
                    }
                  />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

/** Staff start on the overview, investors in the marketplace, vendors at the shop counter. */
function Home() {
  const role = useAuth().profile?.role;
  if (can.useStaffApp(role)) return <OverviewPage />;
  return <Navigate to={can.invest(role) ? '/invest' : '/redeem'} replace />;
}

function SetupNeeded() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-sm text-zinc-700">
      <h1 className="mb-3 text-xl font-semibold text-zinc-900">Supabase isn't configured yet</h1>
      <p>
        Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>, fill in your
        project's URL and publishable key (Supabase → Project Settings → API), then restart{' '}
        <code>npm run dev</code>.
      </p>
    </div>
  );
}
