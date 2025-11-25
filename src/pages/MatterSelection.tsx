import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ArrowRight } from 'lucide-react';
import { apiService } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

const MatterSelection: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [totalMatters, setTotalMatters] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    } else {
      navigate('/login');
    }
    setIsLoading(false);
  }, [navigate]);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;

      try {
        setIsLoadingStats(true);
        
        // Fetch all matters for the user
        const mattersResponse = await apiService.getMatters();
        const matters = mattersResponse.matters || [];
        setTotalMatters(matters.length);

        // Fetch reports for all matters in parallel
        const reportPromises = matters.map(matter => 
          apiService.getMatterReports(matter.matterId).catch(() => ({ success: true, reports: [] }))
        );
        
        const reportResponses = await Promise.all(reportPromises);
        const allReports = reportResponses.flatMap(response => response.reports || []);
        
        setTotalReports(allReports.length);
        
        // Calculate total spent: $19 per paid report (based on pricing page)
        const paidReports = allReports.filter(report => report.isPaid);
        const calculatedTotal = paidReports.length * 19;
        setTotalSpent(calculatedTotal);
        
      } catch (error) {
        console.error('Error fetching stats:', error);
        // Set defaults on error
        setTotalMatters(0);
        setTotalReports(0);
        setTotalSpent(0);
      } finally {
        setIsLoadingStats(false);
      }
    };

    if (user) {
      fetchStats();
    }
  }, [user]);

  const handleNewMatter = () => {
    navigate('/new-matter');
  };

  const handleExistingMatter = () => {
    navigate('/existing-matter');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner text="Loading..." size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-4xl mx-auto px-8 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Welcome back, <span className="text-red-600">{user?.firstName}</span>
          </h1>
          <p className="text-xl text-gray-600">
            Choose how you'd like to proceed with your report generation
          </p>
        </div>

        {/* Matter Selection Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* New Matter Card */}
          <div className="card hover:shadow-xl transition-all duration-300 cursor-pointer group" onClick={handleNewMatter}>
            <div className="text-center p-8">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:bg-red-200 transition-colors duration-300">
                <Plus className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">New Matter</h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                Start a new matter and generate reports for a fresh case or investigation.
              </p>
              <div className="flex items-center justify-center text-red-600 font-semibold group-hover:text-red-700 transition-colors duration-300">
                <span>Create New Matter</span>
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
              </div>
            </div>
          </div>

          {/* Existing Matter Card */}
          <div className="card hover:shadow-xl transition-all duration-300 cursor-pointer group" onClick={handleExistingMatter}>
            <div className="text-center p-8">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:bg-blue-200 transition-colors duration-300">
                <Search className="w-10 h-10 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Existing Matter</h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                Continue working on an existing matter and add more reports to your case.
              </p>
              <div className="flex items-center justify-center text-blue-600 font-semibold group-hover:text-blue-700 transition-colors duration-300">
                <span>Select Existing Matter</span>
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center space-x-8 bg-white rounded-2xl px-8 py-6 shadow-lg">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {isLoadingStats ? '...' : totalMatters}
              </div>
              <div className="text-sm text-gray-600">Total Matters</div>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {isLoadingStats ? '...' : totalReports}
              </div>
              <div className="text-sm text-gray-600">Reports Generated</div>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {isLoadingStats ? '...' : `A$${totalSpent.toFixed(2)}`}
              </div>
              <div className="text-sm text-gray-600">Total Spent</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MatterSelection;

