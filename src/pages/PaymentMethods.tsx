import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Plus, Trash2, Check } from 'lucide-react';
import { apiService } from '../services/api';

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
  cardholderName: string;
}

const PaymentMethods = () => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);
      loadPaymentMethods(parsedUser.userId);
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const loadPaymentMethods = async (userId?: number) => {
    try {
      setIsLoading(true);
      const targetUserId = userId || user?.userId;
      if (!targetUserId) {
        console.error('No user ID available');
        return;
      }
      
      const response = await apiService.getPaymentMethods(targetUserId);
      
      if (response.success) {
        setPaymentMethods(response.paymentMethods);
      }
    } catch (error) {
      console.error('Error loading payment methods:', error);
    } finally {
      setIsLoading(false);
    }
  };


  const handleSetDefault = async (methodId: string) => {
    if (!user?.userId) return;
    
    try {
      const response = await apiService.setDefaultPaymentMethod(methodId);

      if (response.success) {
        setPaymentMethods(prev => 
          prev.map(method => ({
            ...method,
            isDefault: method.id === methodId
          }))
        );
      }
    } catch (error) {
      console.error('Error setting default payment method:', error);
    }
  };

  const handleDelete = async (methodId: string) => {
    if (!user?.userId) return;
    
    if (!confirm('Are you sure you want to delete this payment method?')) {
      return;
    }

    try {
      const response = await apiService.deletePaymentMethod(methodId);

      if (response.success) {
        setPaymentMethods(prev => prev.filter(method => method.id !== methodId));
      }
    } catch (error) {
      console.error('Error deleting payment method:', error);
    }
  };

  const getCardIcon = (brand: string) => {
    switch (brand.toLowerCase()) {
      case 'visa':
        return '💳';
      case 'mastercard':
        return '💳';
      case 'amex':
        return '💳';
      default:
        return '💳';
    }
  };

  if (!user) {
    return (
      <div className="pt-16 md:pt-20 min-h-screen bg-gradient-to-br from-white via-credion-grey to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-credion-red mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-16 md:pt-20 min-h-screen bg-gradient-to-br from-white via-credion-grey to-white">
      <div className="container-custom section-padding">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-4">
              <Link
                to="/payment-method"
                className="btn-primary inline-flex items-center justify-center space-x-2 w-full sm:w-auto px-4 py-2 text-sm sm:text-base"
              >
                <Plus size={16} className="sm:w-5 sm:h-5" />
                <span>Add New</span>
              </Link>
            </div>
          </div>

          {/* Payment Methods List */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-credion-red mx-auto mb-4"></div>
                <p className="text-gray-600">Loading payment methods...</p>
              </div>
            ) : paymentMethods.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 sm:p-8 lg:p-12 text-center">
                <CreditCard className="text-gray-400 mx-auto mb-4 sm:w-16 sm:h-16" size={48} />
                <h3 className="text-lg sm:text-xl font-semibold text-credion-charcoal mb-2">No Payment Methods</h3>
                <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">You haven't added any payment methods yet.</p>
                <Link to="/payment-method" className="btn-primary w-full sm:w-auto">
                  Add Your First Payment Method
                </Link>
              </div>
            ) : (
              paymentMethods.map((method) => (
                <div
                  key={method.id}
                  className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
                >
                  <div className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="w-10 h-6 sm:w-12 sm:h-8 bg-credion-red rounded flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs sm:text-sm font-bold">
                            {getCardIcon(method.brand)}
                          </span>
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <h3 className="text-base sm:text-lg font-semibold text-credion-charcoal truncate">
                              {method.brand} •••• {method.last4}
                            </h3>
                            {method.isDefault && (
                              <span className="bg-credion-red text-white text-xs px-2 py-1 rounded-full w-fit">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 truncate">
                            {method.cardholderName} • Expires {method.expiryMonth.toString().padStart(2, '0')}/{method.expiryYear}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end space-x-1 sm:space-x-2">
                        {!method.isDefault && (
                          <button
                            onClick={() => handleSetDefault(method.id)}
                            className="p-2 text-gray-600 hover:text-credion-red transition-colors duration-200"
                            title="Set as default"
                          >
                            <Check size={16} className="sm:w-5 sm:h-5" />
                          </button>
                        )}
                        
                        
                        <button
                          onClick={() => handleDelete(method.id)}
                          className="p-2 text-gray-600 hover:text-red-600 transition-colors duration-200"
                          title="Delete"
                        >
                          <Trash2 size={16} className="sm:w-5 sm:h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Info Section */}
          <div className="mt-6 sm:mt-8 bg-blue-50 border border-blue-200 rounded-2xl p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-blue-900 mb-2">Payment Security</h3>
            <p className="text-blue-800 text-xs sm:text-sm">
              Your payment information is encrypted and processed securely through Stripe. 
              We never store your full card details on our servers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentMethods;
