import { useState, useEffect } from 'react';
import { CreditCard, Plus, Trash2, Star, StarOff, Lock, Eye, EyeOff } from 'lucide-react';
import { apiService } from '../services/api';
import StripeCardElement from '../components/StripeCardElement';
import LoadingSpinner from '../components/LoadingSpinner';

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName: string;
  isDefault: boolean;
}

type ActiveSection = 'payment' | 'password';

const UserProfile = () => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeSection, setActiveSection] = useState<ActiveSection>('payment');
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);


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
        const response = await apiService.deletePaymentMethod(id);
        if (response.success) {
          fetchPaymentMethods();
        }
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
      const response = await apiService.setDefaultPaymentMethod(id);
      if (response.success) {
        fetchPaymentMethods();
      }
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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError('New password must be different from current password.');
      return;
    }

    setChangingPassword(true);

    try {
      const response = await apiService.changePassword(currentPassword, newPassword);
      if (response.success) {
        setPasswordSuccess('Password changed successfully!');
        // Clear form
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        // Clear success message after 3 seconds
        setTimeout(() => setPasswordSuccess(''), 3000);
      }
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to change password. Please check your current password.');
    } finally {
      setChangingPassword(false);
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
                <button
                  onClick={() => setActiveSection('payment')}
                  className={`w-full flex items-center space-x-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-left text-sm sm:text-base transition-colors ${
                    activeSection === 'payment'
                      ? 'bg-credion-red text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <CreditCard size={18} />
                  <span className="font-medium">Payment Methods</span>
                </button>
                <button
                  onClick={() => setActiveSection('password')}
                  className={`w-full flex items-center space-x-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-left text-sm sm:text-base transition-colors ${
                    activeSection === 'password'
                      ? 'bg-credion-red text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Lock size={18} />
                  <span className="font-medium">Change Password</span>
                </button>
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {activeSection === 'payment' ? (
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
                      <LoadingSpinner text="Loading payment methods..." size="md" />
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
            ) : (
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-4 sm:p-6 border-b">
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold text-credion-charcoal">Change Password</h3>
                    <p className="text-gray-600 mt-1 text-sm sm:text-base">Update your account password</p>
                  </div>
                </div>

                <div className="p-4 sm:p-6">
                  <form onSubmit={handleChangePassword} className="max-w-md space-y-6">
                    {passwordError && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-600 text-sm">{passwordError}</p>
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-green-600 text-sm">{passwordSuccess}</p>
                      </div>
                    )}

                    <div>
                      <label htmlFor="currentPassword" className="block text-sm font-semibold text-credion-charcoal mb-2">
                        Current Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                          type={showCurrentPassword ? "text" : "password"}
                          id="currentPassword"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                          className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                          placeholder="Enter your current password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-credion-red transition-colors duration-200"
                        >
                          {showCurrentPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="newPassword" className="block text-sm font-semibold text-credion-charcoal mb-2">
                        New Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                          type={showNewPassword ? "text" : "password"}
                          id="newPassword"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          minLength={8}
                          className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-credion-red focus:border-transparent transition-all duration-200"
                          placeholder="Enter new password (min. 8 characters)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-credion-red transition-colors duration-200"
                        >
                          {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="confirmPassword" className="block text-sm font-semibold text-credion-charcoal mb-2">
                        Re-enter New Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          id="confirmPassword"
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
                      disabled={changingPassword}
                      className="w-full btn-primary text-lg py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {changingPassword ? 'Changing Password...' : 'Change Password'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
