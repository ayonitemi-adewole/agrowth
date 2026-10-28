import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { ToastContainer } from 'react-toastify';
import { AppProvider, useApp } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';
import FullPageLoader from './components/layout/FullPageLoader';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Transact = lazy(() => import('./pages/Transact'));
const Deposit = lazy(() => import('./pages/Deposit'));
const DepositSuccess = lazy(() => import('./pages/DepositSuccess'));
const Withdraw = lazy(() => import('./pages/Withdraw'));
const Invest = lazy(() => import('./pages/Invest'));
const Product = lazy(() => import('./pages/Product'));
const InvestProductPage = lazy(() => import('./pages/InvestProductPage'));
const QuickInvestPage = lazy(() => import('./pages/QuickInvestPage'));
const Settings = lazy(() => import('./pages/Settings'));
const AddInvestmentProduct = lazy(() => import('./pages/addinvestment'));
const NotFound = lazy(() => import('./pages/NotFound'));

const Toasts = () => {
  const { theme } = useApp();
  return <ToastContainer position="top-center" autoClose={3000} theme={theme} newestOnTop closeOnClick pauseOnFocusLoss={false} />;
};

const App = () => (
  <AppProvider>
    <MotionConfig reducedMotion="user">
      <Router>
        <Suspense fallback={<FullPageLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/sign-in" element={<Login />} />
            <Route path="/sign-up" element={<Register />} />
            <Route path="/transact/deposit-success" element={<DepositSuccess />} />
            <Route path="/add" element={<AddInvestmentProduct />} />

            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/invest" element={<Invest />} />
              <Route path="/invest/product/:id" element={<InvestProductPage />} />
              <Route path="/invest/quick-invest/fast-vegetable/:id" element={<QuickInvestPage />} />
              <Route path="/product/:id" element={<Product />} />
              <Route path="/transact" element={<Transact />} />
              <Route path="/transact/deposit" element={<Deposit />} />
              <Route path="/transact/withdraw" element={<Withdraw />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/edit" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/:section" element={<Settings />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Router>
    </MotionConfig>
    <Toasts />
  </AppProvider>
);

export default App;
