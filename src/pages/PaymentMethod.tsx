import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Check } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { apiService } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_51SIdKfHzbA6hZtQghlH9aivNQpRNOnnYRyk5TvpsapHXkvF8tW2bVlnuP02FaWgF9jBNEVz4NykC35KOMgx9IDIq00EvTPwU4F');

const PaymentForm = () => {
  const [cardholderName, setCardholderName] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!stripe || !elements) {
      setError('Stripe is not loaded. Please refresh the page.');
      return;
    }

    if (!user) {
      setError('User not found. Please log in again.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const cardElement = elements.getElement(CardElement);
      
      if (!cardElement) {
        setError('Card element not found. Please refresh the page.');
        setIsLoading(false);
        return;
      }

      // Create payment method using Stripe
      const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: {
          name: cardholderName,
        },
      });

      if (stripeError) {
        setError(stripeError.message || 'Failed to create payment method. Please try again.');
        setIsLoading(false);
        return;
      }

      if (!paymentMethod) {
        setError('Failed to create payment method. Please try again.');
        setIsLoading(false);
        return;
      }

      // Send payment method ID to backend
      const paymentData = {
        stripePaymentMethodId: paymentMethod.id,
        cardholderName: cardholderName,
        isDefault: isDefault,
        userId: user.userId
      };

      const response = await apiService.addPaymentMethod(paymentData) as any;
      
      if (response.success) {
        // Redirect to dashboard
        navigate('/dashboard');
      } else {
        setError(response.message || 'Failed to save payment method. Please try again.');
      }
    } catch (error: any) {
      setError(error.message || 'Failed to save payment method. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    navigate('/dashboard');
  };

  if (!user) {
    return (
      <div className="pt-16 md:pt-20 min-h-screen bg-gradient-to-br from-white via-credion-grey to-white flex items-center justify-center">
        <LoadingSpinner text="Loading..." size="lg" />
      </div>
    );
  }

  return (
    <div className="pt-16 md:pt-20 min-h-screen bg-gradient-to-br from-white via-credion-grey to-white">
      <div className="container-custom section-padding">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-8">
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Cardholder Name */}
                <div>
                  <label htmlFor="cardholderName" className="block text-sm font-semibold text-credion-charcoal mb-2">
                    Cardholder Name *
                  </label>
                  <input
                    type="text"
                    id="cardholderName"
                    name="cardholderName"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                    placeholder="John Doe"
                  />
                </div>

                {/* Card Details (Stripe Elements) */}
                <div>
                  <label className="block text-sm font-semibold text-credion-charcoal mb-2">
                    Card Details *
                  </label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10" size={20} />
                    <div className="pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-credion-red focus-within:border-transparent transition-all duration-200">
                      <CardElement
                        options={{
                          style: {
                            base: {
                              fontSize: '16px',
                              color: '#1f2937',
                              '::placeholder': {
                                color: '#9ca3af',
                              },
                            },
                            invalid: {
                              color: '#dc2626',
                            },
                          },
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Default Card Checkbox */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isDefault"
                    name="isDefault"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="mr-3 text-credion-red focus:ring-credion-red"
                  />
                  <label htmlFor="isDefault" className="text-sm text-gray-600">
                    Set as default payment method
                  </label>
                </div>

                {/* Security Notice */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <Check className="text-blue-600 mr-2 mt-0.5" size={16} />
                    <div className="text-sm text-blue-800">
                      <p className="font-semibold mb-1">Secure Payment Processing</p>
                      <p>Your payment information is encrypted and processed securely through Stripe. We never store your full card details.</p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    type="submit"
                    disabled={isLoading || !stripe}
                    className="flex-1 btn-primary text-lg py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Saving...' : 'Save Payment Method'}
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg transition-all duration-200"
                  >
                    Skip for Now
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Back to Dashboard */}
          <div className="text-center mt-8">
            <Link to="/dashboard" className="text-credion-red hover:text-credion-red-dark font-semibold inline-flex items-center">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

const PaymentMethod = () => {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm />
    </Elements>
  );
};

export default PaymentMethod;
