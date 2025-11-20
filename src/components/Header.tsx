import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { apiService } from '../services/api';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const location = useLocation();
  const navigate = useNavigate();


  useEffect(() => {
    // Check if user is logged in
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  
  }, [location.pathname]); // Re-check when route changes

  const handleLogout = async () => {
    try {
      await apiService.logout();
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      setUser(null);
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
      // Force logout even if API call fails
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      setUser(null);
      navigate('/');
    }
  };

  const navigation = [
    { name: 'Product', href: '/product' },
    { name: 'Matters', href: '/search' },
    { name: 'Why Credion', href: '/why-credion' },
    { name: 'Government', href: '/government' },
    { name: 'Pricing', href: '/pricing' },
    { name: 'Resources', href: '/resources' },
    { name: 'About', href: '/about' },
  ];

  return (
    <header className="bg-white border-b border-gray-200 px-16 py-6 flex justify-between items-center shadow-sm sticky top-0 z-50">
            {/* Logo */}
            <Link to={user ? "/matter-selection" : "/"} className="flex items-center">
        <img src="/Asset 2@4x-8.png" alt="Credion Logo" className="h-10 w-auto" />
      </Link>

      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center space-x-10">
        {navigation.map((item) => (
          <Link
            key={item.name}
            to={item.href}
            className={`text-sm font-medium transition-colors duration-300 ${
              location.pathname === item.href
                ? 'text-red-600'
                : 'text-gray-600 hover:text-red-600'
            }`}
          >
            {item.name}
          </Link>
        ))}
      </nav>

            {/* Header Actions - Desktop Only */}
            <div className="hidden md:flex items-center space-x-5">
              {user ? (
                <>
                  <Link
                    to="/my-matters"
                    className="text-gray-600 text-sm font-medium hover:text-red-600 transition-colors duration-300"
                  >
                    My Matters
                  </Link>
                  <Link
                    to="/user-profile"
                    className="text-gray-600 text-sm font-medium hover:text-red-600 transition-colors duration-300"
                  >
                    My Account
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="text-gray-600 text-sm font-medium hover:text-red-600 transition-colors duration-300"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="text-gray-600 text-sm font-medium hover:text-red-600 transition-colors duration-300"
                  >
                    Login
                  </Link>
                  <Link
                    to="/signup"
                    className="bg-red-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 hover:bg-red-700 hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    Signup
                  </Link>
                </>
              )}
            </div>

      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden p-2 text-gray-600 hover:text-red-600 transition-colors duration-300 rounded-lg hover:bg-gray-100"
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white shadow-lg border-t z-50">
          <div className="py-4 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block px-6 py-3 text-sm font-medium transition-colors duration-200 ${
                  location.pathname === item.href
                    ? 'text-red-600 bg-red-50 border-r-4 border-red-600'
                    : 'text-gray-600 hover:text-red-600 hover:bg-gray-50'
                }`}
              >
                {item.name}
              </Link>
            ))}
            <div className="px-6 py-2 space-y-1 border-t border-gray-100">
              {user ? (
                <>
                  <Link
                    to="/my-matters"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50 transition-colors duration-200 rounded-lg"
                  >
                    My Matters
                  </Link>
                  <Link
                    to="/user-profile"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50 transition-colors duration-200 rounded-lg"
                  >
                    My Account
                  </Link>
                  <Link
                    to="/search"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block bg-red-600 text-white px-4 py-3 rounded-lg text-sm font-semibold text-center mx-4 hover:bg-red-700 transition-colors duration-200"
                  >
                    Search Reports
                  </Link>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMobileMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50 transition-colors duration-200 rounded-lg"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50 transition-colors duration-200 rounded-lg"
                  >
                    Login
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block bg-red-600 text-white px-4 py-3 rounded-lg text-sm font-semibold text-center mx-4 hover:bg-red-700 transition-colors duration-200"
                  >
                    Signup
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;