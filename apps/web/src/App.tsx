import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireStaff, RoleGate } from './components/Guards';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { AuthTransitionScreen, SplashScreen } from './components/SplashScreen';
import { can } from './lib/roles';
import { OfflineProvider } from './lib/offline/OfflineProvider';
import { AppRouter, RouteProgress, ScrollToTop } from './lib/routing';
import { isConfigured } from './lib/supabase';
import { AuthPage } from './pages/AuthPage';
import {
  BankFilesPage,
  BuyerPortalPage,
  CertificatePage,
  CooperativesPage,
  CycleDetailPage,
  CyclesPage,
  FarmerDetailPage,
  FarmersPage,
  FieldVisitPage,
  FieldWorkPage,
  homePath,
  InvestorProfilePage,
  InvestorsPage,
  LandingPage,
  LedgerPage,
  ListingPage,
  MapFarmPage,
  MarketplacePage,
  PortfolioPage,
  ProgrammeDetailPage,
  ProgrammesPage,
  RedeemPage,
  RegisterFarmerPage,
  SimulatedCheckoutPage,
  UsersPage,
  VendorsPage,
  VoucherSlipsPage,
} from './pages/lazy';
import { OverviewPage } from './pages/OverviewPage';

export function App() {
  // The welcome page needs no backend, so it shows even before Supabase is set up.
  if (!isConfigured) {
    return (
      <AppRouter>
        <RouteProgress />
        <ScrollToTop />
        <Suspense fallback={<SplashScreen />}>
          <Routes>
            <Route path="/welcome" element={<LandingPage />} />
            <Route path="*" element={<SetupNeeded />} />
          </Routes>
        </Suspense>
      </AppRouter>
    );
  }
  // The router sits outside the auth provider, so signing out can move to the sign-in page
  // in the same step as clearing the session.
  return (
    <AppRouter>
      <AuthProvider>
        <OfflineProvider>
          <ToastProvider>
            <RouteProgress />
            <ScrollToTop />
            <AuthTransitionScreen />
            <Suspense fallback={<SplashScreen />}>
              <Routes>
                <Route path="/welcome" element={<LandingPage />} />
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
                  <Route
                    path="pay/simulated"
                    element={
                      <RoleGate allow={can.invest}>
                        <SimulatedCheckoutPage />
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
                      path="buyer"
                      element={
                        <RoleGate allow={can.useBuyerPortal}>
                          <BuyerPortalPage />
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
                      path="bank"
                      element={
                        <RoleGate allow={can.readBankFiles}>
                          <BankFilesPage />
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
          </ToastProvider>
        </OfflineProvider>
      </AuthProvider>
    </AppRouter>
  );
}

/** Staff start on the overview, investors in the marketplace, vendors at the shop counter. */
function Home() {
  const role = useAuth().profile?.role;
  if (can.useStaffApp(role)) return <OverviewPage />;
  return <Navigate to={homePath(role)} replace />;
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
