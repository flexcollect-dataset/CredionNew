import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, RefreshCw, Bell, Plus } from 'lucide-react';
import { apiService } from '../services/api';

interface Report {
  id: number;
  reportName: string;
  isPaid: boolean;
  reportId: number;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
}

const MatterReports: React.FC = () => {
  const navigate = useNavigate();
  const { matterId } = useParams();
  const [matter, setMatter] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  useEffect(() => {
    if (matterId) {
      loadMatter();
      loadReports();
    }
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

  const loadReports = async () => {
    setIsLoadingReports(true);
    try {
      const reportsResponse = await apiService.getMatterReports(Number(matterId));
      if (reportsResponse.success) {
        setReports(reportsResponse.reports || []);
      }
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setIsLoadingReports(false);
    }
  };

  const handleDownload = (report: Report) => {
    // Open download URL in new tab
    window.open(report.downloadUrl, '_blank');
  };

  const handleUpdate = (report: Report) => {
    // TODO: Implement update functionality
    console.log('Update report:', report);
    alert('Update functionality coming soon');
  };

  const handleAlert = (report: Report) => {
    // TODO: Implement alert functionality
    console.log('Set alert for report:', report);
    alert('Alert functionality coming soon');
  };

  const handleAddNewReport = () => {
    if (matterId) {
      // Store the matterId in localStorage so the search page can use it
      localStorage.setItem('currentMatter', JSON.stringify({ matterId: Number(matterId), matterName: matter?.matterName, description: matter.description }));
      // Navigate to search page
      navigate('/search');
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
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
          <button
            onClick={handleAddNewReport}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Plus size={20} />
            <span>Add New Report</span>
          </button>
        </div>

        {/* Reports List */}
        {isLoadingReports ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <p className="text-gray-600">Loading reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <div className="mb-6">
              <FileText className="mx-auto h-24 w-24 text-gray-400" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              No Reports Yet
            </h2>
            <p className="text-xl text-gray-600 max-w-md mx-auto mb-6">
              Reports for this matter will appear here once they are generated.
            </p>
            <button
              onClick={handleAddNewReport}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium mx-auto"
            >
              <Plus size={20} />
              <span>Add New Report</span>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
              <p className="text-sm text-gray-600 mt-1">{reports.length} report{reports.length !== 1 ? 's' : ''} found</p>
            </div>
            <div className="divide-y">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="p-6 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center space-x-4 flex-1">
                    <FileText className="h-6 w-6 text-blue-600" />
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900">
                        {report.reportName.replace('.pdf', '')}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Created: {formatDate(report.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleDownload(report)}
                      className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                      title="Download Report"
                    >
                      <Download size={20} />
                    </button>
                    <button
                      onClick={() => handleUpdate(report)}
                      className="p-2 hover:bg-green-50 rounded-lg transition-colors text-green-600"
                      title="Update Report"
                    >
                      <RefreshCw size={20} />
                    </button>
                    <button
                      onClick={() => handleAlert(report)}
                      className="p-2 hover:bg-yellow-50 rounded-lg transition-colors text-yellow-600"
                      title="Set Alert"
                    >
                      <Bell size={20} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MatterReports;
