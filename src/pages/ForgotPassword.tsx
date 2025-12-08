import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { apiService } from '../services/api';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  useEffect(() => {
    if (token && !email) {
      setError('');
    }
  }, [token, email]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess(false);

    try {
      const response = await apiService.forgotPassword(email);
      
      if (response.success) {
        setSuccess(true);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to send password reset email. Please try again.');
      setSuccess(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (!token) {
      setError('Invalid reset token.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiService.forgotPassword(undefined, token, password);
      
      if (response.success) {
        setSuccess(true);
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to reset password. The link may have expired. Please request a new one.');
    } finally {
      setIsLoading(false);
    }
  };

  const isResetMode = !!token;

  return (
    <div className="pt-16 md:pt-20 min-h-screen bg-gradient-to-br from-white via-credion-grey to-white">
      <div className="container-custom section-padding">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold text-credion-charcoal mb-6">
              {isResetMode ? 'Reset Password' : 'Forgot Password'}
            </h1>
            <p className="text-gray-600">
              {isResetMode ? 'Enter your new password' : 'Enter your email to receive a password reset link'}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-8">
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              {success ? (
                <div className="space-y-6">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-600 text-sm">
                      {isResetMode 
                        ? 'Your password has been reset successfully! Redirecting to login...'
                        : 'A password reset link has been sent. Please check your email inbox.'}
                    </p>
                  </div>
                  <div className="text-center space-y-4">
                    {!isResetMode && (
                      <p className="text-gray-600 text-sm">
                        Didn't receive the email? Check your spam folder or try again.
                      </p>
                    )}
                    <Link 
                      to="/login" 
                      className="text-credion-red hover:text-credion-red-dark font-semibold inline-block"
                    >
                      {isResetMode ? 'Go to Login' : 'Back to Login'}
                    </Link>
                  </div>
                </div>
              ) : isResetMode ? (
                <form onSubmit={handlePasswordReset} className="space-y-6">
                  <div>
                    <label htmlFor="password" className="block text-sm font-semibold text-credion-charcoal mb-2">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                      <input
                        type={showPassword ? "text" : "password"}
                        id="password"
                        name="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                        placeholder="Enter new password (min. 8 characters)"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-credion-red transition-colors duration-200"
                      >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="confirmPassword" className="block text-sm font-semibold text-credion-charcoal mb-2">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        id="confirmPassword"
                        name="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                        placeholder="Confirm new password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-credion-red transition-colors duration-200"
                      >
                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isLoading || !token}
                    className="w-full btn-primary text-lg py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Resetting Password...' : 'Reset Password'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleEmailSubmit} className="space-y-6">
                  <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-credion-charcoal mb-2">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                      <input
                        type="email"
                        id="email"
                        name="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                        placeholder="your.email@company.com"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isLoading}
                    className="w-full btn-primary text-lg py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
              )}
            </div>

            <div className="bg-credion-grey px-8 py-6 text-center text-sm">
              <span className="text-gray-600 mr-2">Remember your password?</span>
              <Link to="/login" className="text-credion-red hover:text-credion-red-dark font-semibold">Login</Link>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link to="/" className="text-credion-red hover:text-credion-red-dark font-semibold inline-flex items-center">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
