import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, Calendar, ArrowRight } from 'lucide-react';
import { apiService } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

interface Matter {
  matterId: number;
  matterName: string;
  description: string;
  status: string;
  createdAt: string | undefined;
  updatedAt: string | undefined;
}

const MyMatters: React.FC = () => {
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
    }
    setIsLoading(false);
  }, [navigate]);

  useEffect(() => {
    loadMatters();
  }, []);

  useEffect(() => {
    // Filter matters based on search query
    let filtered = matters;
    
    if (searchQuery.trim()) {
      filtered = filtered.filter(matter =>
        matter.matterName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (matter.description && matter.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    setFilteredMatters(filtered);
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
        setError('Failed to load matters');
      }
    } catch (error: any) {
      console.error('Error loading matters:', error);
      setError(error.message || 'Failed to load matters');
    } finally {
      setIsSearching(false);
    }
  };

  const handleMatterSelect = (matter: Matter) => {
    navigate(`/matter-reports/${matter.matterId}`);
  };


  const formatDate = (dateString: string | undefined) => {
    if (!dateString) {
      return 'Date not available';
    }
    
    const date = new Date(dateString);
    
    // Check if the date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    return date.toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'archived':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 pt-16">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner text="Loading..." size="md" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              My Matters
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Manage all your matters in one place
            </p>
          </div>
          <button
            onClick={() => navigate('/new-matter')}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors duration-300 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Matter
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
              placeholder="Search matters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {isSearching && (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600 mx-auto mb-2"></div>
            <p className="text-gray-600 text-sm">Loading matters...</p>
          </div>
        )}

        {/* Matters List */}
        {!isSearching && (
          <>
            {filteredMatters.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {matters.length === 0 ? 'No Matters Found' : 'No Matching Matters'}
                </h3>
                <p className="text-gray-600 text-sm mb-4">
                  {matters.length === 0 
                    ? "You haven't created any matters yet. Create your first matter to get started."
                    : "Try adjusting your search terms or filter options."
                  }
                </p>
                {matters.length === 0 && (
                  <button
                    onClick={() => navigate('/new-matter')}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors duration-300"
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
                    className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-all duration-200 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 cursor-pointer" onClick={() => handleMatterSelect(matter)}>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors duration-200">
                            {matter.matterName}
                          </h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(matter.status)}`}>
                            {matter.status}
                          </span>
                        </div>
                        
                        {matter.description && (
                          <p className="text-gray-600 text-sm mb-2 line-clamp-1">
                            {matter.description}
                          </p>
                        )}
                        
                        <div className="flex items-center text-xs text-gray-500">
                          <Calendar className="w-3 h-3 mr-1" />
                          Created {formatDate(matter.createdAt)}
                        </div>
                      </div>
                      
                      <div className="flex items-center ml-4">
                        <button
                          onClick={() => handleMatterSelect(matter)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors duration-200"
                          title="Select Matter"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MyMatters;
