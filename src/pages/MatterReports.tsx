import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, RefreshCw, Bell, Plus, Mail, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiService } from '../services/api';

interface Report {
  id: number;
  reportName: string;
  isPaid: boolean;
  reportId: number;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
  reportType: string | null;
  searchWord: string | null;
}

const MatterReports: React.FC = () => {
  const navigate = useNavigate();
  const { matterId } = useParams();
  const [matter, setMatter] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(20);

  useEffect(() => {
    if (matterId) {
      setCurrentPage(1); // Reset to first page when matter changes
      loadMatter();
    }
  }, [matterId]);

  useEffect(() => {
    if (matterId) {
      loadReports();
    }
  }, [currentPage, matterId]);

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
      const reportsResponse = await apiService.getMatterReports(Number(matterId), currentPage, pageSize);
      if (reportsResponse.success) {
        setReports(reportsResponse.reports || []);
        if (reportsResponse.pagination) {
          setTotalPages(reportsResponse.pagination.totalPages);
          setTotalCount(reportsResponse.pagination.totalCount);
        }
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

  const handleEmailClick = (report: Report) => {
    setSelectedReport(report);
    setEmailAddress('');
    setEmailError('');
    setEmailModalOpen(true);
  };

  const handleCloseEmailModal = () => {
    setEmailModalOpen(false);
    setSelectedReport(null);
    setEmailAddress('');
    setEmailError('');
  };

  const handleSendEmail = async () => {
    if (!selectedReport) return;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailAddress.trim()) {
      setEmailError('Please enter an email address');
      return;
    }
    if (!emailRegex.test(emailAddress.trim())) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setIsSendingEmail(true);
    setEmailError('');

    try {
      const response = await apiService.sendReports(
        emailAddress.trim(),
        [selectedReport.reportName],
        matter?.matterName
      );

      if (response.success) {
        alert(`Report sent successfully to ${emailAddress.trim()}`);
        handleCloseEmailModal();
      } else {
        setEmailError(response.message || 'Failed to send email');
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      setEmailError(error.message || 'Failed to send email. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
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
              <p className="text-sm text-gray-600 mt-1">
                {totalCount} report{totalCount !== 1 ? 's' : ''} found
                {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created At
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Report Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Search Word
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 text-blue-600 mr-3" />
                          <span className="text-sm text-gray-900">
                            {formatDate(report.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">
                          {report.reportType || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-900">
                          {report.searchWord || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => handleDownload(report)}
                            className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                            title="Download Report"
                          >
                            <Download size={20} />
                          </button>
                          <button
                            onClick={() => handleEmailClick(report)}
                            className="p-2 hover:bg-purple-50 rounded-lg transition-colors text-purple-600"
                            title="Email Report"
                          >
                            <Mail size={20} />
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-6 border-t flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} reports
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`px-3 py-2 rounded-lg transition-colors ${
                            currentPage === pageNum
                              ? 'bg-blue-600 text-white'
                              : 'border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Email Modal */}
      {emailModalOpen && selectedReport && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={handleCloseEmailModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Email Report</h2>
              <button
                onClick={handleCloseEmailModal}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  Send <span className="font-medium">{selectedReport.reportName.replace('.pdf', '')}</span> to:
                </p>
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => {
                    setEmailAddress(e.target.value);
                    setEmailError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isSendingEmail && emailAddress.trim()) {
                      handleSendEmail();
                    }
                  }}
                  placeholder="Enter email address"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={isSendingEmail}
                  autoFocus
                />
                {emailError && (
                  <p className="text-red-600 text-sm mt-2">{emailError}</p>
                )}
              </div>
              <div className="flex items-center justify-end space-x-3">
                <button
                  onClick={handleCloseEmailModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={isSendingEmail}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={isSendingEmail || !emailAddress.trim()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isSendingEmail ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Mail size={16} />
                      <span>Send</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatterReports;
