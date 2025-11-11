import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { apiService } from '../services/api';

const NewMatter: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [matterName, setMatterName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      navigate('/login');
      return;
    }
    setIsLoading(false);
  }, [navigate]);

  const handleCreateMatter = async () => {
    if (!matterName.trim()) {
      setError('Matter name is required');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      console.log('Attempting to create matter...');
      const response = await apiService.createMatter({
        matterName: matterName.trim(),
        description: description.trim() || null
      });

      console.log('Create matter response:', response);

      if (response && response.success) {
        console.log('Matter created successfully, navigating to search');
        // Store matter info in localStorage for the search page
        localStorage.setItem('currentMatter', JSON.stringify(response.matter));
        navigate('/search');
      } else {
        const errorMsg = response?.message || response?.message || 'Failed to create matter';
        console.error('Matter creation failed:', errorMsg);
        setError(errorMsg);
      }
    } catch (error: any) {
      console.error('Error creating matter:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      setError(error.message || 'Failed to create matter');
    } finally {
      setIsCreating(false);
    }
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
      <div className="max-w-4xl mx-auto px-6 py-6">
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
              <h1 className="text-2xl font-bold text-gray-900">Create New Matter</h1>
              <p className="text-sm text-gray-600 mt-1">
                Give your matter a name and description to get started
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Form Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="space-y-6">
                {/* Matter Name */}
                <div>
                  <label htmlFor="matterName" className="block text-sm font-semibold text-gray-700 mb-2">
                    Matter Name *
                  </label>
                  <input
                    type="text"
                    id="matterName"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="e.g., ABC Company Investigation, XYZ Litigation"
                    value={matterName}
                    onChange={(e) => setMatterName(e.target.value)}
                    maxLength={255}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Choose a descriptive name for your matter
                  </p>
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
                    Description (Optional)
                  </label>
                  <textarea
                    id="description"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent min-h-[120px] resize-none"
                    placeholder="Add any additional details about this matter..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {description.length}/1000 characters
                  </p>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex space-x-3 pt-4">
                  <button
                    onClick={() => navigate('/matter-selection')}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateMatter}
                    disabled={isCreating || !matterName.trim()}
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200 flex items-center justify-center"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Matter
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Tips */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Tips</h3>
              <div className="space-y-2 text-xs text-gray-600">
                <div className="flex items-start">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 mr-2 flex-shrink-0"></div>
                  <span>Use clear, descriptive names</span>
                </div>
                <div className="flex items-start">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 mr-2 flex-shrink-0"></div>
                  <span>Include case numbers if available</span>
                </div>
                <div className="flex items-start">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 mr-2 flex-shrink-0"></div>
                  <span>Add relevant parties or entities</span>
                </div>
              </div>
            </div>

            {/* What's Next */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">What happens next?</h3>
              <p className="text-xs text-blue-700 leading-relaxed">
                After creating your matter, you'll be taken to the search page where you can generate reports for organizations or individuals.
              </p>
            </div>

            {/* Recent Matters Preview */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Matters</h3>
              <div className="space-y-2">
                <div className="text-xs text-gray-500 italic">
                  No recent matters yet
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewMatter;

