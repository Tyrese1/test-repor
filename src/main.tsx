import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import ResetPassword from './ResetPassword';
import VerifyEmail from './VerifyEmail';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const path = window.location.pathname.replace(/\/$/, '');
const isResetPage = path === '/reset-password';
const isVerifyPage = path === '/verify-email';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isResetPage ? (
        <ResetPassword />
      ) : isVerifyPage ? (
        <VerifyEmail />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
);
