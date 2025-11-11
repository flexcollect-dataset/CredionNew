import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, CreditCard, Settings, ArrowLeft, Plus, Trash2, Star } from 'lucide-react';
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

const Profile = () => {
  const [user, setUser] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);
      loadPaymentMethods(parsedUser.userId);
    } else {
      setError('User not found');
      setLoading(false);
    }
  }, []);

  const loadPaymentMethods = async (userId: number) => {
    try {
      setLoading(true);
      const response = await apiService.getPaymentMethods(userId);
      if (response.success) {
        setPaymentMethods(response.paymentMethods);
      } else {
        setError('Failed to load payment methods');
      }
    } catch (error) {
      console.error('Load payment methods error:', error);
      setError('Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (paymentMethodId: string) => {
    try {
      const response = await apiService.setDefaultPaymentMethod(paymentMethodId);
      if (response.success && user) {
        loadPaymentMethods(user.userId);
      } else {
        setError(response?.message || 'Failed to set default payment method');
      }
    } catch (error) {
      console.error('Set default payment method error:', error);
      setError('Failed to set default payment method');
    }
  };

  const handleDeletePaymentMethod = async (paymentMethodId: string) => {
    if (!window.confirm('Are you sure you want to delete this payment method?')) {
      return;
    }

    try {
      const response = await apiService.deletePaymentMethod(paymentMethodId);
      if (response.success && user) {
        loadPaymentMethods(user.userId);
      } else {
        setError(response?.message || 'Failed to delete payment method');
      }
    } catch (error) {
      console.error('Delete payment method error:', error);
      setError('Failed to delete payment method');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-credion-red"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link to="/dashboard" className="btn-primary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="container-custom py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link
                to="/dashboard"
                className="flex items-center text-gray-600 hover:text-credion-red transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* User Information */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <div className="text-center">
                <div className="w-20 h-20 bg-credion-red rounded-full flex items-center justify-center mx-auto mb-4">
                  <User className="text-white" size={32} />
                </div>
                <h2 className="text-xl font-bold text-credion-charcoal mb-2">
                  {user?.firstName} {user?.lastName}
                </h2>
                <p className="text-gray-600 mb-4">{user?.email}</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-600">Member Since</span>
                    <span className="text-sm font-medium text-credion-charcoal">
                      {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-600">Account Status</span>
                    <span className="text-sm font-medium text-green-600">Active</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                  <CreditCard className="text-credion-red" size={24} />
                  <h3 className="text-xl font-bold text-credion-charcoal">Payment Methods</h3>
                </div>
                <Link
                  to="/payment-method"
                  className="btn-primary inline-flex items-center space-x-2"
                >
                  <Plus size={16} />
                  <span>Add New</span>
                </Link>
              </div>

              {paymentMethods.length === 0 ? (
                <div className="text-center py-12">
                  <CreditCard className="text-gray-400 mx-auto mb-4" size={48} />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No Payment Methods</h4>
                  <p className="text-gray-600 mb-6">Add a payment method to get started with your searches.</p>
                  <Link to="/payment-method" className="btn-primary">
                    Add Payment Method
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {paymentMethods.map((method) => (
                    <div
                      key={method.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-credion-red transition-colors"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded flex items-center justify-center">
                          <CreditCard className="text-white" size={16} />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-credion-charcoal">
                              {method.brand.toUpperCase()} •••• {method.last4}
                            </span>
                            {method.isDefault && (
                              <div className="flex items-center space-x-1 bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                                <Star size={12} />
                                <span>Default</span>
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            Expires {method.expiryMonth.toString().padStart(2, '0')}/{method.expiryYear}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {!method.isDefault && (
                          <button
                            onClick={() => handleSetDefault(method.id)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => handleDeletePaymentMethod(method.id)}
                          className="text-sm text-red-600 hover:text-red-800 transition-colors p-1"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {paymentMethods.length > 0 && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <Settings className="text-blue-600 mt-1" size={16} />
                    <div>
                      <h4 className="text-sm font-medium text-blue-900 mb-1">Payment Method Management</h4>
                      <p className="text-sm text-blue-700">
                        Your default payment method will be used for all transactions. 
                        You can change your default payment method at any time.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
