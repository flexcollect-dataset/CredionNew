import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { apiService } from '../services/api';

const MatterReports: React.FC = () => {
  const navigate = useNavigate();
  const { matterId } = useParams();
  const [matter, setMatter] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMatter();
  }, [matterId]);

  const loadMatter = async () => {
    setIsLoading(true);
    try {
      const matterResponse = await apiService.getMatter(Number(matterId));
      if (matterResponse.success) {
        setMatter(matterResponse.matter);
      }
    } catch (error) {
      console.error('Error loading matter:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/my-matters')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to Matters"
            >
              <ArrowLeft size={24} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {isLoading ? 'Loading...' : matter?.matterName || 'Matter Reports'}
              </h1>
              {matter?.description && (
                <p className="text-gray-600 mt-1">{matter.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Coming Soon Content */}
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <div className="mb-6">
            <FileText className="mx-auto h-24 w-24 text-gray-400" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Reports Coming Soon
          </h2>
          <p className="text-xl text-gray-600 max-w-md mx-auto">
            We're working on bringing you comprehensive reporting functionality. Stay tuned!
          </p>
        </div>
      </div>
    </div>
  );
};

export default MatterReports;
