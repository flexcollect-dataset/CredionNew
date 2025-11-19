import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-gradient-to-b from-gray-900 to-black text-white py-16 mt-24">
      <div className="max-w-6xl mx-auto px-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-16 mb-12">
          {/* Brand */}
          <div className="pr-10">
            <div className="flex items-center space-x-2.5 mb-5">
              <div className="w-9 h-9">
                <img src="/CREDION-FileLOGO.svg" alt="Credion Logo" className="w-full h-full" />
              </div>
              <span className="text-2xl font-bold tracking-tight">credion</span>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed mb-8">
              Rectify the commercial credit reporting with the Predict™ Score, predicting repayment likelihood, not just credit history.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-white font-semibold text-sm transition-all duration-300 hover:bg-red-600 hover:-translate-y-1">
                in
              </a>
              <a href="#" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center text-white font-semibold text-sm transition-all duration-300 hover:bg-red-600 hover:-translate-y-1">
                𝕏
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-base font-bold mb-6 uppercase tracking-wider">Product</h3>
            <ul className="space-y-4">
              <li>
                <Link to="/product" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Predict™ Score
                </Link>
              </li>
              <li>
                <Link to="/product" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Credit Reports
                </Link>
              </li>
              <li>
                <Link to="/search" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Monitoring
                </Link>
              </li>
              <li>
                <Link to="/api" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  API Integration
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-base font-bold mb-6 uppercase tracking-wider">Company</h3>
            <ul className="space-y-4">
              <li>
                <Link to="/about" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/why-credion" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Why Credion
                </Link>
              </li>
              <li>
                <Link to="/government" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Government
                </Link>
              </li>
              <li>
                <Link to="/resources" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Resources
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-gray-300 hover:text-red-600 transition-all duration-300 text-sm hover:pl-1 inline-block">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-base font-bold mb-6 uppercase tracking-wider">Contact</h3>
            <div className="space-y-4">
              <div className="flex items-start space-x-2.5">
                <span className="text-red-600 text-base mt-0.5">✉</span>
                <span className="text-gray-300 text-sm">info@credion.com.au</span>
              </div>
              <div className="text-gray-300 text-sm leading-relaxed">
                <div>5/63-68 Sussex St, Sydney NSW 2000</div>
                <div>85 Third Green, 2nd Floor, San Francisco, California 94103</div>
                <div>49 Warwick Street, London, Greater London W1B 5AW</div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-5 md:space-y-0">
            <div className="text-gray-500 text-sm">
              © 2025 Credion™. All rights reserved.
            </div>
            <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-8">
              <a href="#" className="text-gray-500 hover:text-red-600 transition-colors duration-300 text-sm">
                Privacy Policy
              </a>
              <a href="#" className="text-gray-500 hover:text-red-600 transition-colors duration-300 text-sm">
                Terms of Service
              </a>
              <a href="#" className="text-gray-500 hover:text-red-600 transition-colors duration-300 text-sm">
                Credit Guide
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;