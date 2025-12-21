import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, RefreshCw, Bell, Plus, Mail, X, ChevronLeft, ChevronRight, Network } from 'lucide-react';
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
  abn: string | null;
  numAlerts?: number;
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
  const [alertCounts, setAlertCounts] = useState<Record<string, number>>({});
  const [entityIdMap, setEntityIdMap] = useState<Record<string, number>>({});
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationTotalPages, setNotificationTotalPages] = useState(1);
  const [selectedReportAbn, setSelectedReportAbn] = useState<string | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<string | null>(null);
  const [selectedUserReportId, setSelectedUserReportId] = useState<number | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);


  useEffect(() => {
    if (matterId) {
      setCurrentPage(1);
      loadMatter();
    }
    
    const storedCounts = localStorage.getItem('watchlistAlertCounts');
    if (storedCounts) {
      try {
        setAlertCounts(JSON.parse(storedCounts));
      } catch (error) {
        console.error('Error parsing stored alert counts:', error);
      }
    }
    
    const storedEntityIds = localStorage.getItem('watchlistEntityIds');
    if (storedEntityIds) {
      try {
        setEntityIdMap(JSON.parse(storedEntityIds));
      } catch (error) {
        console.error('Error parsing stored entity IDs:', error);
      }
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

  const handleAlert = async (report: Report) => {
    const abn = report.abn;
    if (!abn) {
      alert('No ABN found for this report.');
      return;
    }

    const entityId = entityIdMap[abn];
    if (!entityId) {
      alert('Entity ID not found for this ABN. Please click "Check Watchlist Alerts" first.');
      return;
    }

    setSelectedEntityId(entityId);
    setSelectedReportAbn(abn);
    setSelectedReportType(report.reportType || null);
    setSelectedUserReportId(report.id);
    setNotificationPage(1);
    setNotificationsModalOpen(true);
    await loadNotifications(entityId, 1);
  };

  const loadNotifications = async (entityId: number, page: number) => {
    setIsLoadingNotifications(true);
    try {
      const response = await apiService.getWatchlistNotifications(entityId, page);
      if (response.success) {
        setNotifications(response.data);
        setNotificationTotalPages(response.last_page);
        setNotificationPage(response.current_page);
      } else {
        alert('Failed to load notifications: ' + (response.message || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Error loading notifications:', error);
      alert('Error loading notifications: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  const handleCloseNotificationsModal = () => {
    setNotificationsModalOpen(false);
    setSelectedEntityId(null);
    setSelectedReportAbn(null);
    setNotifications([]);
    setNotificationPage(1);
  };

  const formatNotificationDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const groupNotificationsByType = (notifications: any[]) => {
    const grouped: Record<string, any[]> = {};
    
    notifications.forEach((notification) => {
      const type = notification.type || notification.case_type || 'Other';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(notification);
    });
    
    return grouped;
  };

  const handleFetchWatchlistAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const response = await apiService.getWatchlistEntities();
      
      if (response.success && response.data) {
        const counts: Record<string, number> = response.counts || {};
        const entityIds: Record<string, number> = response.entityIds || {};
        
        // Build counts and entityIds from data if not provided in response
        if (!response.counts || !response.entityIds) {
          response.data.forEach((entity) => {
            if (entity.abn) {
              if (entity.num_alerts > 0) {
                counts[entity.abn] = entity.num_alerts;
              }
              entityIds[entity.abn] = entity.id;
            }
          });
        }

        setAlertCounts(counts);
        setEntityIdMap(entityIds);
        localStorage.setItem('watchlistAlertCounts', JSON.stringify(counts));
        localStorage.setItem('watchlistEntityIds', JSON.stringify(entityIds));
        
        const userData = localStorage.getItem('user');
        if (userData) {
          const mattersResponse = await apiService.getMatters();
          const matters = mattersResponse.matters || [];
          
          let totalMatchedReports = 0;
          for (const matter of matters) {
            try {
              const reportsResponse = await apiService.getMatterReports(matter.matterId, 1, 1000);
              if (reportsResponse.success && reportsResponse.reports) {
                const matchedReports = reportsResponse.reports.filter((report: any) => 
                  report.abn && counts[report.abn] && counts[report.abn] > 0
                );
                totalMatchedReports += matchedReports.length;
              }
            } catch (error) {
              console.error(`Error fetching reports for matter ${matter.matterId}:`, error);
            }
          }
          
          const totalAlerts = Object.values(counts).reduce((sum, count) => sum + count, 0);
          alert(`Successfully loaded alerts. Found ${totalAlerts} total alerts across ${Object.keys(counts).length} ABNs. Matched ${totalMatchedReports} reports across all matters.`);
        } else {
          const totalAlerts = Object.values(counts).reduce((sum, count) => sum + count, 0);
          alert(`Successfully loaded alerts. Found ${totalAlerts} total alerts across ${Object.keys(counts).length} ABNs.`);
        }
      } else {
        const errorMsg = response.message || response.error || 'Failed to fetch watchlist entities. Please check the watchlist ID.';
        alert(errorMsg);
      }
    } catch (error: any) {
      console.error('Error fetching watchlist alerts:', error);
      alert('Error fetching watchlist alerts: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoadingAlerts(false);
    }
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
          <div className="flex items-center space-x-3">
            <button
              onClick={handleFetchWatchlistAlerts}
              disabled={isLoadingAlerts}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoadingAlerts ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <Bell size={18} />
                  <span>Check Watchlist Alerts</span>
                </>
              )}
            </button>
	    <button
              onClick={() => navigate(`/mind-map/${matterId}`)}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
            >
              <Network size={20} />
              <span>Mind Map</span>
            </button>
            <button
              onClick={handleAddNewReport}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Plus size={20} />
              <span>Add New Report</span>
            </button>
          </div>
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
                            className="p-2 hover:bg-yellow-50 rounded-lg transition-colors text-yellow-600 relative"
                            title={report.numAlerts && report.numAlerts > 0 ? `${report.numAlerts} alert(s) for ABN ${report.abn}` : 'Set Alert'}
                          >
                            <Bell size={20} />
                            {report.numAlerts && report.numAlerts > 0 && (
                              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                                {report.numAlerts}
                              </span>
                            )}
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

      {/* Notifications Modal */}
      {notificationsModalOpen && selectedEntityId && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={handleCloseNotificationsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
                {selectedReportAbn && (
                  <p className="text-sm text-gray-600 mt-1">ABN: {selectedReportAbn}</p>
                )}
              </div>
              <button
                onClick={handleCloseNotificationsModal}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingNotifications ? (
                <div className="text-center py-8">
                  <RefreshCw size={32} className="animate-spin mx-auto text-gray-400" />
                  <p className="text-gray-600 mt-4">Loading notifications...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8">
                  <Bell size={48} className="mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600">No notifications found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const grouped = groupNotificationsByType(notifications);
                    const taxDebtNotifications = grouped['Tax Debt'] || [];
                    const asicNotifications = grouped['ASIC Document'] || [];
                    const otherNotifications = Object.entries(grouped)
                      .filter(([type]) => type !== 'Tax Debt' && type !== 'ASIC Document')
                      .flatMap(([, notifs]) => notifs);

                    return (
                      <>
                        {/* Grouped Tax Debt Notifications */}
                        {taxDebtNotifications.length > 0 && (
                          <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-2">
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                    Pending
                                  </span>
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                    Tax Debt
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {taxDebtNotifications.length} update{taxDebtNotifications.length > 1 ? 's' : ''}
                                  </span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-1">
                                  {taxDebtNotifications[0]?.entity?.party_name || 'Unknown Entity'}
                                </h3>
                                {taxDebtNotifications[0]?.source && (
                                  <p className="text-sm text-gray-600 mb-2">
                                    Source: {taxDebtNotifications[0].source}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="mb-2">
                              <p className="text-sm font-medium text-gray-900 mb-2">Tax debt changed</p>
                              <p className="text-xs text-gray-500 italic mb-3">Main data and amount is blur</p>
                              
                              <div className="space-y-2">
                                {taxDebtNotifications.map((notification, index) => (
                                  <div key={notification.id} className="p-2 bg-gray-50 rounded text-xs">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-gray-600">
                                        Update #{index + 1} - {formatNotificationDate(notification.created_at)}
                                      </span>
                                    </div>
                                    {notification.data && (
                                      <div className="mt-1 space-y-1">
                                        {notification.data.date && (
                                          <p>
                                            <strong>Date:</strong>{' '}
                                            <span className="blur-sm">{new Date(notification.data.date).toLocaleDateString()}</span>
                                          </p>
                                        )}
                                        {notification.data.action && (
                                          <p>
                                            <strong>Action:</strong>{' '}
                                            <span className="blur-sm">{notification.data.action}</span>
                                          </p>
                                        )}
                                        {notification.data.amount !== undefined && (
                                          <p>
                                            <strong>Amount:</strong>{' '}
                                            <span className="blur-sm">${notification.data.amount.toLocaleString()}</span>
                                          </p>
                                        )}
                                        {notification.data.previous_amount !== undefined && (
                                          <p>
                                            <strong>Previous Amount:</strong>{' '}
                                            <span className="blur-sm">${notification.data.previous_amount.toLocaleString()}</span>
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ASIC Document Notifications */}
                        {asicNotifications.map((notification) => (
                          <div
                            key={notification.id}
                            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    notification.status === 'Pending' 
                                      ? 'bg-yellow-100 text-yellow-800' 
                                      : 'bg-green-100 text-green-800'
                                  }`}>
                                    {notification.status}
                                  </span>
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                    {notification.type}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {formatNotificationDate(notification.created_at)}
                                  </span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-1">
                                  {notification.entity?.party_name || 'Unknown Entity'}
                                </h3>
                                {notification.source && (
                                  <p className="text-sm text-gray-600 mb-2">
                                    Source: {notification.source}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="mb-2">
                              <p className="text-sm font-medium text-gray-900 mb-2">Document has changed</p>
                              <p className="text-xs text-gray-500 italic mb-3">Main data blur</p>
                              
                              {notification.asic_document && (
                                <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
                                  <p>
                                    <strong>ASIC Document:</strong>{' '}
                                    <span className="blur-sm">{notification.asic_document.description}</span>
                                  </p>
                                  {notification.asic_document.uuid && (
                                    <p>
                                      <strong>UUID:</strong>{' '}
                                      <span className="blur-sm">{notification.asic_document.uuid}</span>
                                    </p>
                                  )}
                                </div>
                              )}
                              
                              {notification.details && (
                                <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                                  <p className="blur-sm">{notification.details}</p>
                                </div>
                              )}
                              
                              {notification.insolvency_risk_factor && (
                                <div className="mt-2">
                                  <span className="text-xs font-medium text-gray-600">
                                    Insolvency Risk Factor:{' '}
                                    <span className="text-red-600 blur-sm">{notification.insolvency_risk_factor}</span>
                                  </span>
                                </div>
                              )}
                            </div>
                            
            
                          </div>
                        ))}

                        {/* Other Notifications */}
                        {otherNotifications.map((notification) => (
                          <div
                            key={notification.id}
                            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-2">
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    notification.status === 'Pending' 
                                      ? 'bg-yellow-100 text-yellow-800' 
                                      : 'bg-green-100 text-green-800'
                                  }`}>
                                    {notification.status}
                                  </span>
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                    {notification.type}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {formatNotificationDate(notification.created_at)}
                                  </span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-1">
                                  {notification.entity?.party_name || 'Unknown Entity'}
                                </h3>
                                {notification.source && (
                                  <p className="text-sm text-gray-600 mb-2">
                                    Source: {notification.source}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            {notification.details_html ? (
                              <div 
                                className="text-sm text-gray-700 mb-2"
                                dangerouslySetInnerHTML={{ __html: notification.details_html }}
                              />
                            ) : notification.details ? (
                              <p className="text-sm text-gray-700 mb-2">{notification.details}</p>
                            ) : null}
                            
                            {notification.url && (
                              <a
                                href={notification.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-800 mt-2 inline-block"
                              >
                                View Details →
                              </a>
                            )}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            
            {notificationTotalPages > 1 && (
              <div className="p-6 border-t flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Page {notificationPage} of {notificationTotalPages}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => selectedEntityId && loadNotifications(selectedEntityId, notificationPage - 1)}
                    disabled={notificationPage === 1 || isLoadingNotifications}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>
                  <button
                    onClick={() => selectedEntityId && loadNotifications(selectedEntityId, notificationPage + 1)}
                    disabled={notificationPage >= notificationTotalPages || isLoadingNotifications}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
            
            {/* Pay Button */}
            <div className="p-6 border-t bg-gray-50">
              <button
                onClick={async () => {
                  if (!selectedReportAbn) {
                    alert('ABN not found. Cannot process payment.');
                    return;
                  }

                  if (!selectedReportType) {
                    alert('Report type not found for this report.');
                    return;
                  }

                  if (!selectedUserReportId) {
                    alert('Report row not found. Cannot update user report.');
                    return;
                  }

                  setIsProcessingPayment(true);
                  try {
                    const response = await apiService.payForWatchlistReport(
                      selectedReportAbn,
                      selectedReportType,
                      matterId ? Number(matterId) : undefined,
                      selectedUserReportId
                    );

                    if (response.success) {
                      alert('Payment processed successfully! Report created and PDF generated.');
                      handleCloseNotificationsModal();
                      if (matterId) {
                        loadReports();
                      }
                    } else {
                      alert('Payment failed: ' + (response.message || 'Unknown error'));
                    }
                  } catch (error: any) {
                    console.error('Error processing payment:', error);
                    alert('Error processing payment: ' + (error.message || 'Unknown error'));
                  } finally {
                    setIsProcessingPayment(false);
                  }
                }}
                disabled={isProcessingPayment || !selectedReportAbn || !selectedReportType}
                className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold text-base shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isProcessingPayment ? (
                  <>
                    <RefreshCw size={20} className="animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>Pay $50</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatterReports;
