import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, FileText, Calendar, ArrowRight } from 'lucide-react';
import { apiService } from '../services/api';

interface Matter {
  matterId: number;
  matterName: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  reportCount: number;
}

const ExistingMatter: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [filteredMatters, setFilteredMatters] = useState<Matter[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      navigate('/login');
      return;
    }
    setIsLoading(false);
  }, [navigate]);

  useEffect(() => {
    loadMatters();
  }, []);

  useEffect(() => {
    // Filter matters based on search query
    if (searchQuery.trim()) {
      const filtered = matters.filter(matter =>
        matter.matterName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (matter.description && matter.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setFilteredMatters(filtered);
    } else {
      setFilteredMatters(matters);
    }
  }, [searchQuery, matters]);

  const loadMatters = async () => {
    setIsSearching(true);
    setError('');

    try {
      const response = await apiService.getMatters();
      if (response.success) {
        setMatters(response.matters);
        setFilteredMatters(response.matters);
      } else {
        setError(response.message || 'Failed to load matters');
      }
    } catch (error: any) {
      console.error('Error loading matters:', error);
      setError(error.message || 'Failed to load matters');
    } finally {
      setIsSearching(false);
    }
  };

  const handleMatterSelect = (matter: Matter) => {
    // Store matter info in localStorage for the search page
    localStorage.setItem('currentMatter', JSON.stringify(matter));
    navigate('/search');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/matter-selection')}
              className="flex items-center text-gray-600 hover:text-red-600 transition-colors duration-200"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Select Existing Matter</h1>
              <p className="text-sm text-gray-600 mt-1">
                Choose from your existing matters to continue working
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg border border-gray-200 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              className="w-full px-10 py-3 border-0 rounded-lg focus:outline-none focus:ring-0"
              placeholder="Search matters by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-600 text-xs">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {isSearching && (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600 mx-auto mb-3"></div>
            <p className="text-gray-600 text-sm">Loading matters...</p>
          </div>
        )}

        {/* Matters List */}
        {!isSearching && (
          <>
            {filteredMatters.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 text-center py-8">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {matters.length === 0 ? 'No Matters Found' : 'No Matching Matters'}
                </h3>
                <p className="text-gray-600 text-sm mb-4">
                  {matters.length === 0 
                    ? "You haven't created any matters yet. Create your first matter to get started."
                    : "Try adjusting your search terms or create a new matter."
                  }
                </p>
                {matters.length === 0 && (
                  <button
                    onClick={() => navigate('/new-matter')}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors duration-200"
                  >
                    Create Your First Matter
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMatters.map((matter) => (
                  <div
                    key={matter.matterId}
                    className="bg-white rounded-lg border border-gray-200 hover:shadow-md transition-all duration-200 cursor-pointer group"
                    onClick={() => handleMatterSelect(matter)}
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <h3 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors duration-200">
                              {matter.matterName}
                            </h3>
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                              matter.status === 'active' 
                                ? 'bg-green-100 text-green-800' 
                                : matter.status === 'completed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {matter.status}
                            </span>
                          </div>
                          
                          {matter.description && (
                            <p className="text-gray-600 text-xs mb-2 line-clamp-1">
                              {matter.description}
                            </p>
                          )}
                          
                          <div className="flex items-center space-x-4 text-xs text-gray-500">
                            <div className="flex items-center">
                              <Calendar className="w-3 h-3 mr-1" />
                              Created {formatDate(matter.createdAt)}
                            </div>
                            <div className="flex items-center">
                              <FileText className="w-3 h-3 mr-1" />
                              {matter.reportCount} report{matter.reportCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                        
                        <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-red-600 group-hover:translate-x-1 transition-all duration-200" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Create New Matter Button */}
        {!isSearching && matters.length > 0 && (
          <div className="text-center mt-6">
            <button
              onClick={() => navigate('/new-matter')}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors duration-200"
            >
              Create New Matter Instead
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExistingMatter;

