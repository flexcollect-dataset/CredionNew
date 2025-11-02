import { useState, useEffect } from 'react';
import { CreditCard, Plus, Trash2, Star, StarOff } from 'lucide-react';
import { apiService } from '../services/api';
import StripeCardElement from '../components/StripeCardElement';

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName: string;
  isDefault: boolean;
}

const UserProfile = () => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);


  useEffect(() => {
    fetchPaymentMethods();
  }, []);

  const fetchPaymentMethods = async () => {
    setLoading(true);
    try {
      const response = await apiService.getPaymentMethods();
      if (response.success) {
        setPaymentMethods(response.paymentMethods);
      } else {
        setPaymentMethods([]);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);

    } finally {
      setLoading(false);
    }
  };

  const handleStripePaymentMethod = async (paymentMethod: any) => {
    setLoading(true);
    
    try {
      // Send the Stripe payment method to our backend
      await apiService.addPaymentMethod({
        stripePaymentMethodId: paymentMethod.id,
        cardholderName: paymentMethod.billing_details.name,
        userId: JSON.parse(localStorage.getItem('user') || '{}').userId
      });
      
      setShowAddForm(false);
      fetchPaymentMethods();
    } catch (error) {
      console.error('Error adding payment method:', error);
      // Add to local state when API fails
      const newMethod = {
        id: paymentMethod.id,
        last4: paymentMethod.card.last4,
        brand: paymentMethod.card.brand,
        expiryMonth: paymentMethod.card.exp_month,
        expiryYear: paymentMethod.card.exp_year,
        cardholderName: paymentMethod.billing_details.name,
        isDefault: paymentMethods.length === 0
      };
      setPaymentMethods(prev => [...prev, newMethod]);
      setShowAddForm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePaymentMethod = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this payment method?')) {
      setLoading(true);
      try {
        await apiService.deletePaymentMethod(parseInt(id));
        fetchPaymentMethods();
      } catch (error) {
        console.error('Error deleting payment method:', error);
        // Update local state when API fails
        setPaymentMethods(prev => prev.filter(method => method.id !== id));
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSetDefault = async (id: string) => {
    setLoading(true);
    try {
      await apiService.setDefaultPaymentMethod(parseInt(id));
      fetchPaymentMethods();
    } catch (error) {
      console.error('Error setting default payment method:', error);
      // Update local state when API fails
      setPaymentMethods(prev => prev.map(method => ({
        ...method,
        isDefault: method.id === id
      })));
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      <div className="container-custom py-4 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar */}
          <div className="w-full lg:w-64 bg-white rounded-lg shadow-sm border">
            <div className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-credion-charcoal mb-4 sm:mb-6">Account Settings</h2>
              <nav className="space-y-2">
                <div className="w-full flex items-center space-x-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-left bg-credion-red text-white text-sm sm:text-base">
                  <CreditCard size={18} />
                  <span className="font-medium">Payment Methods</span>
                </div>
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-4 sm:p-6 border-b">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h3 className="text-lg sm:text-xl font-semibold text-credion-charcoal">Payment Methods</h3>
                      <p className="text-gray-600 mt-1 text-sm sm:text-base">Manage your payment methods</p>
                    </div>
                    <button
                      onClick={() => setShowAddForm(!showAddForm)}
                      className="btn-primary flex items-center space-x-2 text-sm sm:text-base px-4 py-2"
                    >
                      <Plus size={18} />
                      <span>Add New Card</span>
                    </button>
                  </div>
                </div>

                {/* Add New Payment Method Form */}
                {showAddForm && (
                  <div className="p-4 sm:p-6 border-b bg-gray-50">
                    <h4 className="text-lg font-medium text-credion-charcoal mb-4">Add New Payment Method</h4>
                    <StripeCardElement
                      onSubmit={handleStripePaymentMethod}
                      onCancel={() => setShowAddForm(false)}
                      loading={loading}
                    />
                  </div>
                )}

                {/* Payment Methods List */}
                <div className="p-4 sm:p-6">
                  {loading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-credion-red mx-auto"></div>
                      <p className="mt-2 text-gray-600">Loading payment methods...</p>
                    </div>
                  ) : paymentMethods.length === 0 ? (
                    <div className="text-center py-8">
                      <CreditCard size={48} className="mx-auto text-gray-400 mb-4" />
                      <p className="text-gray-600">No payment methods added yet</p>
                      <p className="text-sm text-gray-500 mt-1">Add your first payment method to get started</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:gap-6">
                      {paymentMethods.map((method) => (
                        <div
                          key={method.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow duration-200 gap-4"
                        >
                          <div className="flex items-center space-x-4 min-w-0 flex-1">
                            <div className="w-12 h-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-xs font-bold">
                                {method.brand.toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-credion-charcoal truncate">
                                **** **** **** {method.last4}
                              </p>
                              <p className="text-sm text-gray-600 truncate">
                                {method.cardholderName} • Expires {method.expiryMonth.toString().padStart(2, '0')}/{method.expiryYear}
                              </p>
                              {method.isDefault && (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-1">
                                  <Star size={12} className="mr-1" />
                                  Default
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-end space-x-2">
                            {!method.isDefault && (
                              <button
                                onClick={() => handleSetDefault(method.id)}
                                className="p-2 text-gray-400 hover:text-yellow-500 transition-colors duration-200"
                                title="Set as default"
                              >
                                <StarOff size={20} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePaymentMethod(method.id)}
                              className="p-2 text-gray-400 hover:text-red-500 transition-colors duration-200"
                              title="Delete payment method"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
