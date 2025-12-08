import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import Product from './pages/Product';
import WhyCredion from './pages/WhyCredion';
import Pricing from './pages/Pricing';
import Resources from './pages/Resources';
import About from './pages/About';
import Contact from './pages/Contact';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import PaymentMethod from './pages/PaymentMethod';
import PaymentMethods from './pages/PaymentMethods';
import Profile from './pages/Profile';
import Government from './pages/Government';
import UserProfile from './pages/UserProfile';
import Search from './pages/Search';
import MatterSelection from './pages/MatterSelection';
import NewMatter from './pages/NewMatter';
import ExistingMatter from './pages/ExistingMatter';
import MyMatters from './pages/MyMatters';
import MatterReports from './pages/MatterReports';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white">
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/product" element={<Product />} />
            <Route path="/why-credion" element={<WhyCredion />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/payment-method" element={<PaymentMethod />} />
            <Route path="/payment-methods" element={<PaymentMethods />} />
                  <Route path="/government" element={<Government />} />
                  <Route path="/user-profile" element={<UserProfile />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/matter-selection" element={<MatterSelection />} />
                  <Route path="/new-matter" element={<NewMatter />} />
                  <Route path="/existing-matter" element={<ExistingMatter />} />
                  <Route path="/my-matters" element={<MyMatters />} />
                  <Route path="/matter-reports/:matterId" element={<MatterReports />} />
                </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;