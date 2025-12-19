/**
 * Mind Map Page Component
 * Interactive knowledge map visualization for matter entities and relationships
 * 
 * Location: src/pages/MindMap.tsx
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Maximize2, Minimize2, Settings, Loader2 } from 'lucide-react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { apiService } from '../services/api';

interface Entity {
  id: string;
  name: string;
  type: string;
  acn?: string;
  abn?: string;
  status?: string;
  atoData?: {
    amount: number;
    status?: string;
    date?: string;
    ato_updated_at?: string;
  };
  courtCases?: Array<{
    uuid: string;
    type: string;
    case_number?: string;
    case_name?: string;
    case_type?: string;
    court_name?: string;
    state?: string;
    notification_time?: string;
    url?: string;
    party_role?: string;
    match_on?: string;
  }>;
  [key: string]: any;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  label: string;
  uncertain?: boolean; // Indicates if this relationship is uncertain (name match only, no DOB)
  similarityPercentage?: number | null; // Similarity percentage (0-100) for uncertain matches
  extractId?: string | null; // Extract ID for bankruptcy relationships
}

interface Address {
  id: string;
  address: string;
  address1?: string;
  address2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
  type?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  entityType?: 'Company' | 'Person';
  entityId?: string;
  entityName?: string;
  linkedEntityId?: string; // Old format - single entity
  linkedEntityIds?: string[]; // New format - multiple entities (deduplicated addresses)
  caseUuid?: string;
  partyRole?: string;
  entityTypes?: string[]; // Array of entity types for merged addresses
  caseUuids?: string[]; // Array of court case UUIDs for merged addresses
  partyRoles?: string[]; // Array of party roles for merged addresses
}

interface MindMapData {
  entities: {
    companies: Entity[];
    persons: Entity[]; // Merged directors, office holders, and secretaries
    shareholders: Entity[];
    addresses?: Address[]; // Optional for backward compatibility
    bankruptcies?: Entity[]; // Bankruptcy nodes
    // Keep for backward compatibility
    directors: Entity[];
    secretaries: Entity[];
    officeHolders: Entity[];
  };
  relationships: Relationship[];
  stats: {
    totalCompanies: number;
    totalPersons: number;
    totalDirectors: number;
    totalShareholders: number;
    totalSecretaries: number;
    totalOfficeHolders: number;
    totalAddresses?: number; // Optional for backward compatibility
    totalRelationships: number;
  };
}

const MindMap: React.FC = () => {
  const navigate = useNavigate();
  const { matterId } = useParams();
  const networkRef = useRef<HTMLDivElement>(null);
  const networkInstanceRef = useRef<Network | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mindMapData, setMindMapData] = useState<MindMapData | null>(null);
  const [matterName, setMatterName] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [tooltip, setTooltip] = useState<{ content: string; x: number; y: number } | null>(null);

  const [visibleCategories, setVisibleCategories] = useState({
    companies: true,
    persons: true, // Merged directors, office holders, secretaries
    shareholders: true,
    addresses: true,
    bankruptcies: true,
    // Keep for backward compatibility
    directors: true,
    secretaries: true,
    officeHolders: true,
  });

  // Color scheme - updated with light blue, purple, yellow, green, and red for bad things
   const colors = {
    company: { background: '#60a5fa', border: '#3b82f6' }, // Light blue for Australian companies
    ceasedCompany: { background: '#94a3b8', border: '#64748b' }, // Gray for ceased companies
    director: { background: '#fbbf24', border: '#f59e0b' }, // Yellow for directors
    ceasedDirector: { background: '#94a3b8', border: '#64748b' }, // Red for former/disqualified directors
    officeHolder: { background: '#a78bfa', border: '#8b5cf6' }, // Purple for office holders
    ceasedOfficeHolder: { background: '#64748b', border: '#64748b' }, // Light purple for ceased office holders
    shareholder: { background: '#34d399', border: '#10b981' }, // Green for shareholders
    secretary: { background: '#34d399', border: '#10b981' }, // Green for secretaries (same as shareholder)
    address: { background: '#fb923c', border: '#f97316' }, // Orange for addresses
    ceasedAddress: { background: '#94a3b8', border: '#64748b' }, // Gray for ceased addresses
    companyWithAto: { background: '#ef4444', border: '#dc2626' }, // Red for companies with ATO debt > $0
    companyWithCourt: { background: '#ef4444', border: '#dc2626' }, // Red for companies with court cases
    companyGood: { background: '#60a5fa', border: '#3b82f6' }, // Light blue for companies with no ATO debt or cases
    bankruptcy: { background: '#dc2626', border: '#991b1b' }, // Dark red for bankruptcy
    noBankruptcy: { background: '#10b981', border: '#059669' }, // Green for no bankruptcy
  };

  // Edge colors - gray for former/ceased, blue for current, purple for PPSR
  const getEdgeColorByRelationship = (relationshipType: string, relationshipLabel?: string): any => {
    const type = relationshipType?.toLowerCase() || '';
    const label = relationshipLabel?.toLowerCase() || '';
    
    // Check if it's a PPSR relationship (company or director)
    if (type === 'ppsr_security' || type === 'ppsr_director') {
      // Purple for PPSR relationships
      return { color: '#a78bfa', highlight: '#8b5cf6' };
    }
    
    // Check if it's a bankruptcy relationship
    if (type === 'bankruptcy') {
      // Red for bankruptcy relationships
      return { color: '#dc2626', highlight: '#991b1b' };
    }
    
    // Check if it's a former/ceased/past relationship
    const isFormer = type.includes('former') || type.includes('ceased') || type.includes('past') ||
                     label.includes('former') || label.includes('ceased') || label.includes('past');
    
    if (isFormer) {
      // Gray for former/ceased relationships
      return { color: '#94a3b8', highlight: '#64748b' };
    } else {
      // Blue for current relationships
      return { color: '#60a5fa', highlight: '#3b82f6' };
    }
  };

  // Edge style - dashed for former/ceased/past relationships, dotted for uncertain matches
  const getEdgeStyle = (relationshipType: string, uncertain?: boolean): boolean | number[] => {
    const type = relationshipType?.toLowerCase() || '';
    
    // Dotted pattern for uncertain relationships (name match only, no DOB)
    // vis-network uses array [dashLength, gapLength] for custom patterns
    if (uncertain) {
      return [2, 6]; // Dotted pattern (short dashes and gaps)
    }
    
    // Dashed for former, ceased, or past relationships
    if (type.includes('former') || type.includes('ceased') || type.includes('past')) {
      return true; // Dashed (default pattern)
    }
    
    return false; // Solid
  };

  // Helper function to calculate edge length based on text length

  // Helper function to break text if it's more than 12 characters
  const breakText = (text: string, maxLength: number = 12): string => {
    if (!text) return text;
    
    // Split by newlines first to handle multi-line text
    const lines = text.split('\n');
    const brokenLines: string[] = [];
    
    lines.forEach(line => {
      if (line.length <= maxLength) {
        brokenLines.push(line);
      } else {
        // Break the line into chunks of maxLength
        const words = line.split(' ');
        let currentLine = '';
        
        words.forEach(word => {
          // If a single word is longer than maxLength, break it
          if (word.length > maxLength) {
            if (currentLine) {
              brokenLines.push(currentLine.trim());
              currentLine = '';
            }
            // Break the long word
            for (let i = 0; i < word.length; i += maxLength) {
              brokenLines.push(word.substring(i, i + maxLength));
            }
          } else {
            // Check if adding this word would exceed maxLength
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length <= maxLength) {
              currentLine = testLine;
            } else {
              if (currentLine) {
                brokenLines.push(currentLine.trim());
              }
              currentLine = word;
            }
          }
        });
        
        if (currentLine) {
          brokenLines.push(currentLine.trim());
        }
      }
    });
    
    return brokenLines.join('\n');
  };

  useEffect(() => {
    if (matterId) {
      loadMindMapData();
    }
  }, [matterId]);

  useEffect(() => {
    if (mindMapData && networkRef.current) {
      initializeNetwork();
    }

    return () => {
      if (networkInstanceRef.current) {
        networkInstanceRef.current.destroy();
      }
      setTooltip(null);
    };
  }, [mindMapData]);

  useEffect(() => {
    if (networkInstanceRef.current && mindMapData) {
      updateNetworkVisibility();
    }
  }, [visibleCategories]);

  const loadMindMapData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiService.getMindMapData(Number(matterId));
      
      if (response.success) {
        setMindMapData(response.data);
        setMatterName(response.matterName || '');
      } else {
        setError(response.message || 'Failed to load mind map data');
      }
    } catch (err: any) {
      console.error('Error loading mind map:', err);
      setError(err.message || 'Failed to load mind map data');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to find connected components (clusters)
  const findConnectedComponents = (nodes: any[], edges: any[]): Map<string, number> => {
    const componentMap = new Map<string, number>();
    const visited = new Set<string>();
    let componentId = 0;

    const dfs = (nodeId: string, compId: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      componentMap.set(nodeId, compId);

      // Find all neighbors
      edges.forEach(edge => {
        if (edge.from === nodeId && !visited.has(edge.to)) {
          dfs(edge.to, compId);
        } else if (edge.to === nodeId && !visited.has(edge.from)) {
          dfs(edge.from, compId);
        }
      });
    };

    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        dfs(node.id, componentId);
        componentId++;
      }
    });

    return componentMap;
  };

  const buildNetworkData = () => {
    if (!mindMapData) return { nodes: [], edges: [] };

    const nodes: any[] = [];
    const edges: any[] = [];
    const createdCourtCaseIds = new Set<string>(); // Track court case IDs to prevent duplicates

    // Add companies
    if (visibleCategories.companies) {
      mindMapData.entities.companies.forEach((company) => {
        // Determine company color based on status and type
        let companyColor = colors.company;
        let companyShape: string = 'box';
        const companyStatus = company.status?.toLowerCase() || '';
        
        // Check for ATO debt and court cases (bad things - make red)
        const atoData = (company as any).atoData;
        const courtCases = (company as any).courtCases || [];
        const hasAtoDebt = atoData && atoData.amount > 0;
        const hasCourtCases = courtCases && courtCases.length > 0;
        
        // Build tooltip (without status and ATO information - ATO is shown as separate node)
        let tooltip = `<b>${company.name}</b><br>ACN: ${company.acn || 'N/A'}`;
        
        // Add court case information
        if (hasCourtCases) {
          tooltip += `<br><br><b>Court Cases:</b> ${courtCases.length}`;
          courtCases.slice(0, 3).forEach((courtCase: any, idx: number) => {
            tooltip += `<br>${idx + 1}. ${courtCase.case_number || 'N/A'} - ${courtCase.case_type || 'N/A'}`;
            if (courtCase.court_name) {
              tooltip += ` (${courtCase.court_name})`;
            }
          });
          if (courtCases.length > 3) {
            tooltip += `<br>... and ${courtCases.length - 3} more`;
          }
        }
        
        // Set color based on ATO debt and court cases (red for bad things)
        if (hasAtoDebt || hasCourtCases) {
          companyColor = colors.companyWithAto; // Red for companies with ATO debt or court cases
        } else if (atoData && atoData.amount === 0) {
          companyColor = colors.companyGood; // Light blue for companies with $0 ATO debt
        }
        // Check for ceased companies
        else if (companyStatus.includes('ceased')) {
          companyColor = colors.ceasedCompany;
        }
        
        // Build label without ATO indicator (ATO will be shown as separate node)
        let label = company.name || 'Unknown Company';
        
        // Break text if more than 12 characters
        label = breakText(label);
        
        nodes.push({
          id: company.id,
          label: label,
          title: tooltip,
          shape: companyShape,
          color: companyColor,
          font: { color: '#ffffff', size: 14, bold: true },
          size: 40,
          margin: 20, // Increased margin to create more space around main entities
          // Don't set fixed positions - let physics engine handle it
        });

        // Create separate ATO node if ATO data exists
        if (atoData) {
          const atoId = `ato_${company.id}`;
          const atoAmount = atoData.amount || 0;
          const atoFormatted = new Intl.NumberFormat('en-AU', { 
            style: 'currency', 
            currency: 'AUD',
            maximumFractionDigits: 0
          }).format(atoAmount);
          
          // Build ATO tooltip
          let atoTooltip = `<b>ATO Tax Debt</b><br>Amount: ${atoFormatted}`;
          if (atoData.status) {
            atoTooltip += `<br>Status: ${atoData.status}`;
          }
          if (atoData.ato_updated_at) {
            const updatedDate = new Date(atoData.ato_updated_at).toLocaleDateString('en-AU');
            atoTooltip += `<br>Updated: ${updatedDate}`;
          }
          
          // Determine ATO color: teal (#00BFA6) if $0, red if > $0
          const isZeroDebt = atoAmount === 0;
          const atoNodeColor = isZeroDebt 
            ? { background: '#4FC3F7', border: '#4FC3F7' } // Teal for $0
            : { background: '#ef4444', border: '#dc2626' }; // Red for debt > $0
          const atoEdgeColor = isZeroDebt
            ? { color: '#4FC3F7', highlight: '#4FC3F7' } // Teal for $0
            : { color: '#ef4444', highlight: '#dc2626' }; // Red for debt > $0
          
          // Create ATO node with dollar value inside
          nodes.push({
            id: atoId,
            label: breakText(atoFormatted),
            title: atoTooltip,
            shape: 'ellipse',
            color: atoNodeColor,
            font: { color: '#ffffff', size: 12, bold: true },
            size: 50,
            margin: 10, // Add space between label and border
          });

          // Create edge from company to ATO with label "ATO"
          edges.push({
            id: `edge_${company.id}_${atoId}_ATO`, // Unique ID
            from: company.id,
            to: atoId,
            label: 'ATO',
            arrows: 'to',
            color: atoEdgeColor,
            width: 2,
            dashes: false, // Solid line
            // Remove length property - let physics engine determine optimal edge length
            smooth: {
              enabled: true,
              type: 'dynamic', // Use dynamic routing for better edge placement
              roundness: 0.2, // Consistent roundness
              forceDirection: 'none', // Let the algorithm decide direction
            },
            font: {
              align: 'middle', // Center label in the middle of the edge
              color: '#1f2937',
              size: 12,
              face: 'Arial',
              strokeWidth: 2,
              strokeColor: '#FFFFFF',
              background: '#FFFFFF',
              bold: 'bold' as any,
              vadjust: 0, // Vertical adjustment to keep label centered
            },
            labelHighlightBold: true,
          });
        }

        // Create separate diamond nodes for each court case
        if (hasCourtCases) {
          courtCases.forEach((courtCase: any, index: number) => {
            // Use UUID as primary ID component (UUIDs are unique), fallback to company.id + index only if no UUID
            const caseId = courtCase.uuid 
              ? `court_case_${courtCase.uuid}` 
              : `court_case_${company.id}_${index}`;
            const caseNumber = courtCase.case_number || 'N/A';
            const caseType = courtCase.case_type || courtCase.type || 'Court Case';
            
            // Extract main case type (remove prefixes like "CORPORATIONS - ")
            let cleanCaseType = caseType;
            if (caseType.includes(' - ')) {
              cleanCaseType = caseType.split(' - ')[1] || caseType;
            }
            
            // Build case type label for diamond (wrap if too long)
            let caseLabel = cleanCaseType.toUpperCase();
            if (caseLabel.length > 15) {
              // Break into two lines if too long
              const words = caseLabel.split(' ');
              if (words.length > 1) {
                let line1 = '';
                let line2 = '';
                let currentLine = '';
                words.forEach((word: string, idx: number) => {
                  if ((currentLine + word).length > 15 && currentLine.length > 0) {
                    if (!line1) {
                      line1 = currentLine;
                      currentLine = word;
                    } else {
                      line2 += (line2 ? ' ' : '') + word;
                    }
                  } else {
                    currentLine += (currentLine ? ' ' : '') + word;
                  }
                  if (idx === words.length - 1) {
                    if (!line1) {
                      line1 = currentLine;
                    } else {
                      line2 += (line2 ? ' ' : '') + currentLine;
                    }
                  }
                });
                caseLabel = line1 + (line2 ? '\n' + line2 : '');
              } else {
                // Single long word - split it
                const mid = Math.ceil(caseLabel.length / 2);
                caseLabel = caseLabel.substring(0, mid) + '\n' + caseLabel.substring(mid);
              }
            }

            // Build case tooltip
            let caseTooltip = `<b>${caseType}</b><br>Case Number: ${caseNumber}`;
            if (courtCase.case_name) {
              caseTooltip += `<br>Case Name: ${courtCase.case_name}`;
            }
            if (courtCase.court_name) {
              caseTooltip += `<br>Court: ${courtCase.court_name}`;
            }
            if (courtCase.state) {
              caseTooltip += `<br>State: ${courtCase.state}`;
            }
            if (courtCase.party_role) {
              caseTooltip += `<br>Role: ${courtCase.party_role}`;
            }
            if (courtCase.notification_time) {
              const notificationDate = new Date(courtCase.notification_time).toLocaleDateString('en-AU');
              caseTooltip += `<br>Notification: ${notificationDate}`;
            }
            if (courtCase.url) {
              caseTooltip += `<br><a href="${courtCase.url}" target="_blank">View Details</a>`;
            }

            // Break text if more than 12 characters
            caseLabel = breakText(caseLabel);
            
            // Only create the node if it hasn't been created yet (prevent duplicates)
            const isNewCourtCase = !createdCourtCaseIds.has(caseId);
            if (isNewCourtCase) {
              // Mark this court case as created
              createdCourtCaseIds.add(caseId);
              
              // Create case node (yellow/orange diamond with case type inside)
              nodes.push({
                id: caseId,
                label: caseLabel,
                title: caseTooltip,
                shape: 'circle',
                color: { background: '#a78bfa', border: '#8b5cf6' }, // Yellow/orange for court cases
                font: { color: '#ffffff', size: 11 },
                size: 50,
                margin: 10, // Add space between label and border
              });
            }

            // Create edge from company to case (orange dashed line with case number on edge)
            edges.push({
              id: `edge_${company.id}_${caseId}_${caseNumber.replace(/\s+/g, '_')}`, // Unique ID
              from: company.id,
              to: caseId,
              label: caseNumber, // Case number on the edge (single line)
              arrows: 'to',
              color: { color: '#a78bfa', highlight: '#8b5cf6' }, // Orange color
              width: 2,
              dashes: false, // Solid line
              // Remove length property - let physics engine determine optimal edge length
              smooth: {
                enabled: true,
                type: 'dynamic', // Use dynamic routing for better edge placement
                roundness: 0.2, // Consistent roundness
                forceDirection: 'none', // Let the algorithm decide direction
              },
              font: {
                align: 'middle', // Center label in the middle of the edge
                color: '#1f2937',
                size: 11,
                face: 'Arial',
                strokeWidth: 2,
                strokeColor: '#FFFFFF',
                background: '#FFFFFF',
                bold: 'bold' as any,
                vadjust: 0, // Vertical adjustment to keep label centered
              },
              labelHighlightBold: true,
            });
          });
        }
      });
    }

    // Add merged persons (directors, office holders, secretaries combined)
    if (visibleCategories.persons && mindMapData.entities.persons) {
      mindMapData.entities.persons.forEach((person) => {
        // Determine if person has any ceased roles
        const hasCeasedRole = person.roles?.some((role: any) => 
          role.originalType?.includes('ceased') || role.type?.includes('ceased')
        );
        
        // Build roles list for tooltip
        const rolesList = person.roles?.map((role: any) => {
          if (role.type === 'director') {
            return role.originalType === 'ceased_director' ? 'Former Director' : 'Director';
          } else if (role.type === 'officeholder') {
            return role.originalType === 'ceased_officeholder' ? `Former ${role.role || 'Office Holder'}` : (role.role || 'Office Holder');
          } else if (role.type === 'secretary') {
            return 'Secretary';
          }
          return role.type;
        }).join(', ') || 'Person';
        nodes.push({
          id: person.id,
          label: breakText(person.name),
          title: `<b>${person.name}</b><br>Roles: ${rolesList}${person.dob ? `<br>DOB: ${person.dob}` : ''}`,
          shape: 'circle',
          color: hasCeasedRole ? colors.ceasedDirector : colors.director, // Use director colors for persons
          font: { color: '#ffffff', size: 12 },
          size: 30,
          margin: 8, // Add space between label and border
          // Don't set fixed positions - let physics engine handle it
        });
      });
    }

    // Add shareholders (keep separate as they're not merged with persons)
    if (visibleCategories.shareholders) {
      mindMapData.entities.shareholders.forEach((shareholder) => {
        nodes.push({
          id: shareholder.id,
          label: breakText(shareholder.name),
          title: `<b>${shareholder.name}</b><br>Shareholder${shareholder.shares ? `<br>Shares: ${shareholder.shares}` : ''}`,
          shape: 'circle',
          color: colors.shareholder,
          font: { color: '#ffffff', size: 12 },
          size: 25,
          margin: 8, // Add space between label and border
          // Don't set fixed positions - let physics engine handle it
        });
      });
    }

    // Add addresses
    if (visibleCategories.addresses && mindMapData.entities.addresses && Array.isArray(mindMapData.entities.addresses)) {
      mindMapData.entities.addresses.forEach((address) => {
        // Handle both old format (single linkedEntityId) and new format (array of linkedEntityIds)
        const entityIds = address.linkedEntityIds || (address.linkedEntityId ? [address.linkedEntityId] : []);
        
        // Only show addresses that are linked to at least one entity
        if (entityIds.length === 0) return;

        // Check if at least one linked entity exists in nodes
        const hasLinkedEntity = entityIds.some(entityId => nodes.some(n => n.id === entityId));
        if (!hasLinkedEntity) return;

        // Determine if address is ceased
        const isCeased = address.status?.toLowerCase() === 'ceased' || address.endDate;
        const addressColor = isCeased ? colors.ceasedAddress : colors.address;

        // Build address label (shortened if too long)
        let addressLabel = address.address || '';
        if (addressLabel.length > 25) {
          // Try to use suburb or first part of address
          if (address.suburb) {
            addressLabel = address.suburb;
          } else {
            addressLabel = addressLabel.substring(0, 22) + '...';
          }
        }

        // Build address tooltip with full details
        let addressTooltip = `<b>${address.type || 'Address'}</b><br>${address.address || ''}`;
        if (address.suburb) {
          addressTooltip += `<br>${address.suburb}`;
        }
        if (address.state || address.postcode) {
          addressTooltip += `<br>${[address.state, address.postcode].filter(Boolean).join(' ')}`;
        }
        if (address.startDate) {
          const startDate = new Date(address.startDate).toLocaleDateString('en-AU');
          addressTooltip += `<br>From: ${startDate}`;
        }
        if (address.endDate) {
          const endDate = new Date(address.endDate).toLocaleDateString('en-AU');
          addressTooltip += `<br>To: ${endDate}`;
        }
        
        // Show linked entities (for deduplicated addresses)
        if (entityIds.length > 0) {
          const linkedEntityNames = entityIds
            .map(id => {
              // Find entity in mindMapData
              const allEntities = [
                ...(mindMapData.entities.companies || []),
                ...(mindMapData.entities.persons || []),
                ...(mindMapData.entities.shareholders || [])
              ];
              const entity = allEntities.find(e => e.id === id);
              return entity ? entity.name : null;
            })
            .filter(Boolean);
          
          if (linkedEntityNames.length > 0) {
            addressTooltip += `<br><br><b>Linked to (${linkedEntityNames.length}):</b>`;
            linkedEntityNames.slice(0, 5).forEach(name => {
              addressTooltip += `<br>• ${name}`;
            });
            if (linkedEntityNames.length > 5) {
              addressTooltip += `<br>... and ${linkedEntityNames.length - 5} more`;
            }
          }
        } else if (address.entityName) {
          // Fallback for old format
          addressTooltip += `<br><br>Linked to: ${address.entityName}`;
        }
        
        if (address.caseUuids && address.caseUuids.length > 0) {
          addressTooltip += `<br><br>From ${address.caseUuids.length} Court Case(s)`;
        } else if (address.caseUuid) {
          addressTooltip += `<br><br>From Court Case`;
        }

        nodes.push({
          id: address.id,
          label: breakText(addressLabel),
          title: addressTooltip,
          shape: 'circle', // Small dot shape for addresses
          color: addressColor,
          font: { color: '#ffffff', size: 10 },
          size: 20,
          margin: 10, // Increased margin to prevent addresses from getting too close to main entities
        });
      });
    }

    // Add bankruptcy nodes
    if (visibleCategories.bankruptcies && mindMapData.entities.bankruptcies && Array.isArray(mindMapData.entities.bankruptcies)) {
      mindMapData.entities.bankruptcies.forEach((bankruptcy) => {
        const hasBankruptcy = (bankruptcy as any).hasBankruptcy !== false;
        const bankruptcyColor = hasBankruptcy ? colors.bankruptcy : colors.noBankruptcy;
        const bankruptcyName = bankruptcy.name || (hasBankruptcy ? 'Bankruptcy' : 'No Bankruptcy');
        const fromDate = (bankruptcy as any).from;
        
        // Build bankruptcy tooltip
        let bankruptcyTooltip = `<b>${bankruptcyName}</b>`;
        if (fromDate) {
          const startDate = new Date(fromDate).toLocaleDateString('en-AU');
          bankruptcyTooltip += `<br>Start Date: ${startDate}`;
        }
        if ((bankruptcy as any).extractId) {
          bankruptcyTooltip += `<br>Extract ID: ${(bankruptcy as any).extractId}`;
        }
        if ((bankruptcy as any).uuid) {
          bankruptcyTooltip += `<br>UUID: ${(bankruptcy as any).uuid}`;
        }
        
        nodes.push({
          id: bankruptcy.id,
          label: '', // No label on bankruptcy node
          title: bankruptcyTooltip,
          shape: 'diamond',
          color: bankruptcyColor,
          font: { color: '#ffffff', size: 12, bold: true },
          size: 40,
          margin: 10,
        });
      });
    }

    // Track edges from same source-to-target pair to adjust positioning
    const edgeCountByPair = new Map<string, number>();
    
    // Add relationships
    mindMapData.relationships.forEach((rel) => {
      // Check if both nodes are visible
      const fromVisible = nodes.some(n => n.id === rel.from);
      const toVisible = nodes.some(n => n.id === rel.to);
      
      if (fromVisible && toVisible) {
        // Count edges from this source node to this target node (for same person-company pairs)
        const edgePairKey = `${rel.from}_${rel.to}`;
        const pairCount = edgeCountByPair.get(edgePairKey) || 0;
        edgeCountByPair.set(edgePairKey, pairCount + 1);
        
        // Build edge label with similarity percentage if uncertain (single line, no breaks)
        let edgeLabel = rel.label;
        
        // Special handling for bankruptcy relationships
        if (rel.type === 'bankruptcy') {
          // Find the bankruptcy node to get the date
          const bankruptcyNode = mindMapData.entities.bankruptcies?.find(b => b.id === rel.to);
          if (bankruptcyNode) {
            const hasBankruptcy = (bankruptcyNode as any).hasBankruptcy !== false;
            const fromDate = (bankruptcyNode as any).from;
            
            if (hasBankruptcy && fromDate) {
              // Format date as "from - DD/MM/YYYY"
              const date = new Date(fromDate);
              const formattedDate = date.toLocaleDateString('en-AU', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
              });
              edgeLabel = `from - ${formattedDate}`;
            } else {
              edgeLabel = 'no bankruptcy';
            }
          } else {
            // Fallback if bankruptcy node not found
            edgeLabel = 'no bankruptcy';
          }
        } else if (rel.uncertain && rel.similarityPercentage !== null && rel.similarityPercentage !== undefined) {
          edgeLabel = `${rel.label} (${rel.similarityPercentage}%)`;
        } else if (rel.uncertain) {
          edgeLabel = `${rel.label} (?)`;
        }
        
        // Edge color: gray for former/ceased, blue for current
        const edgeColor = getEdgeColorByRelationship(rel.type, rel.label);
        // Get edge style (dashed for ceased, dotted for uncertain, solid for others)
        const edgeStyle = getEdgeStyle(rel.type, rel.uncertain);
        
        // Build edge object with unique ID for better handling of multiple edges between same nodes
        const edgeId = `edge_${rel.from}_${rel.to}_${rel.type}_${edgeLabel.replace(/\s+/g, '_')}`;
        const edge: any = {
          id: edgeId, // Unique ID helps vis-network handle multiple edges between same nodes
          from: rel.from,
          to: rel.to,
          label: edgeLabel, // Single line, no text breaking
          arrows: 'to',
          arrowStrikethrough: false,
          color: edgeColor,
          width: rel.uncertain ? 1.5 : 2, // Slightly thinner for uncertain relationships
          dashes: edgeStyle, // Can be boolean (true/false) or array [dashLength, gapLength] for custom pattern
          endPointOffset: { to: 0 }, // Remove gap between arrow and node
          // Remove length property - let physics engine determine optimal edge length
          smooth: {
            enabled: true,
            type: 'continuous', // Continuous routing works better with manual node dragging
            roundness: 0.5, // Higher roundness for smoother curves
            forceDirection: 'none', // Let the algorithm decide direction
          },
          font: {
            align: 'middle', // Center label in the middle of the edge, not near the arrow
            color: '#2D3748', // Dark gray for good visibility
            size: 12,
            face: 'Arial',
            strokeWidth: 2, // Add stroke for better visibility
            strokeColor: '#FFFFFF', // White stroke to make label stand out
            background: '#FFFFFF', // White background for label
            bold: true, // Make labels bold for better visibility
            vadjust: 0, // Vertical adjustment to keep label centered
          },
          labelHighlightBold: true, // Make label bold on hover
        };
        
        edges.push(edge);
      }
    });

    // Find connected components to separate unconnected clusters
    // This ensures disconnected networks (e.g., "Indra Budiman" network vs "ZONE MANUFACTURING" network)
    // are visually separated into distinct clusters
    const componentMap = findConnectedComponents(nodes, edges);
    const componentSizes = new Map<number, number>();
    const componentNodes = new Map<number, string[]>();
    
    componentMap.forEach((compId, nodeId) => {
      componentSizes.set(compId, (componentSizes.get(compId) || 0) + 1);
      if (!componentNodes.has(compId)) {
        componentNodes.set(compId, []);
      }
      componentNodes.get(compId)!.push(nodeId);
    });

    // Calculate cluster centers in a circular pattern to maximize separation
    const numComponents = componentSizes.size;
    const clusterSpacing = 800; // Distance between cluster centers
    
    // Assign initial positions based on component ID to separate clusters
    // This helps the physics engine start with separated clusters
    nodes.forEach((node) => {
      const compId = componentMap.get(node.id) || 0;
      const compSize = componentSizes.get(compId) || 1;
      const compNodeList = componentNodes.get(compId) || [];
      const nodeIndexInComponent = compNodeList.indexOf(node.id);
      
      // Calculate cluster center position in a circular/radial layout
      const angle = (compId * 2 * Math.PI) / Math.max(numComponents, 1);
      const centerX = Math.cos(angle) * clusterSpacing;
      const centerY = Math.sin(angle) * clusterSpacing;
      
      // Spread nodes within each cluster in a small circle around the center
      const nodeAngle = (nodeIndexInComponent * 2 * Math.PI) / compSize;
      const nodeRadius = Math.min(compSize * 15, 150); // Max 150px radius per cluster
      const initialX = centerX + Math.cos(nodeAngle) * nodeRadius;
      const initialY = centerY + Math.sin(nodeAngle) * nodeRadius;
      
      // Set initial position (physics will refine it but maintain cluster separation)
      node.x = initialX;
      node.y = initialY;
    });

    return { nodes, edges };
  };

  const initializeNetwork = () => {
    if (!networkRef.current || !mindMapData) return;

    const { nodes, edges } = buildNetworkData();

    const nodesDataSet = new DataSet(nodes);
    const edgesDataSet = new DataSet(edges);

    const data = {
      nodes: nodesDataSet,
      edges: edgesDataSet,
    };

    const options = {
      physics: {
        enabled: true,
        stabilization: {
          enabled: true,
          iterations: 200, // Number of iterations to stabilize
          fit: true,
        },
        barnesHut: {
          gravitationalConstant: -2000,
          centralGravity: 0.1,
          springLength: 300, // Increased spring length for better edge spacing and distance from main entity
          springConstant: 0.04,
          damping: 0.15, // Increased damping to help nodes settle faster
          avoidOverlap: 1.2, // Increased overlap avoidance to prevent nodes from getting too close
        },
        maxVelocity: 50,
        minVelocity: 0.1, // Lowered to ensure physics stops completely when nodes settle
        solver: 'barnesHut',
        timestep: 0.5,
      },
      layout: {
        improvedLayout: true,
        hierarchical: {
          enabled: false, // Use force-directed instead of hierarchical
        },
      },
      interaction: {
        hover: true,
        tooltipDelay: 100,
        zoomView: true,
        dragView: true,
        dragNodes: true,
        navigationButtons: true,
        keyboard: true,
      },
      edges: {
        smooth: {
          enabled: true,
          type: 'continuous', // Continuous routing works better with manual node dragging and minimal physics
          roundness: 0.5, // Higher roundness for smoother curves
          forceDirection: 'none', // Let the algorithm decide optimal direction
        },
        endPointOffset: { to: 0 }, // Remove gap between arrow and node
        selectionWidth: 3,
        font: {
          align: 'middle', // Center labels in the middle of the edge, not near the arrow
          color: '#2D3748', // Dark gray for good visibility
          size: 12,
          face: 'Arial',
          strokeWidth: 2, // Add stroke for better visibility
          strokeColor: '#FFFFFF', // White stroke to make label stand out
          background: '#FFFFFF', // White background for label
          bold: 'bold' as any, // Make labels bold for better visibility
          vadjust: 0, // Vertical adjustment to keep label centered
        },
        labelHighlightBold: true, // Make label bold on hover
        // Remove length property - let physics engine determine optimal edge length
        shadow: {
          enabled: true,
          color: 'rgba(0,0,0,0.1)',
          size: 3,
          x: 1,
          y: 1,
        },
        // Improve edge routing to reduce overlaps
        selfReferenceSize: 20,
      },
      nodes: {
        borderWidth: 2,
        shadow: {
          enabled: true,
          color: 'rgba(0,0,0,0.2)',
          size: 5,
          x: 2,
          y: 2,
        },
      },
    };

    networkInstanceRef.current = new Network(networkRef.current, data, options);

    // Custom tooltip implementation
    let tooltipNodeId: string | null = null;
    
    // Update tooltip position function
    const updateTooltipPosition = (nodeId: string, content: string) => {
      if (!networkInstanceRef.current) return;
      
      // Get node position in canvas coordinates
      const positions = networkInstanceRef.current.getPositions([nodeId]);
      const position = positions[nodeId];
      if (!position) return;
      
      // Convert canvas coordinates to DOM coordinates (relative to network container)
      const domPosition = networkInstanceRef.current.canvasToDOM({
        x: position.x,
        y: position.y
      });
      
      setTooltip({
        content,
        x: domPosition.x,
        y: domPosition.y - 10
      });
    };
    
    networkInstanceRef.current.on('hoverNode' as any, (params: any) => {
      if (params.node && networkInstanceRef.current && networkRef.current) {
        tooltipNodeId = params.node;
        // Get node data from DataSet
        const nodeData = nodesDataSet.get(params.node);
        if (nodeData && nodeData.title) {
          updateTooltipPosition(params.node, nodeData.title);
        }
      }
    });

    networkInstanceRef.current.on('blurNode' as any, () => {
      tooltipNodeId = null;
      setTooltip(null);
    });

    // Track mouse movement to update tooltip position
    if (networkRef.current) {
      const handleMouseMove = (event: MouseEvent) => {
        if (tooltipNodeId && networkInstanceRef.current) {
          const nodeData = nodesDataSet.get(tooltipNodeId);
          if (nodeData && nodeData.title) {
            updateTooltipPosition(tooltipNodeId, nodeData.title);
          }
        }
      };
      
      networkRef.current.addEventListener('mousemove', handleMouseMove);
      networkRef.current.addEventListener('mouseleave', () => {
        tooltipNodeId = null;
        setTooltip(null);
      });
    }

    // Fit the network once physics stabilization is complete, then switch to minimal physics
    // Minimal physics allows edges to reroute smoothly when nodes are dragged, but keeps nodes stable
    let stabilizationComplete = false;
    networkInstanceRef.current.on('stabilizationEnd' as any, () => {
      if (networkInstanceRef.current && !stabilizationComplete) {
        stabilizationComplete = true;
        
        // Fit without animation
        networkInstanceRef.current.fit({
          animation: false,
        });
        
        // Switch to minimal physics mode - keeps nodes stable but allows edges to reroute smoothly
        // This enables smooth edge rerouting when users drag nodes
        networkInstanceRef.current.setOptions({
          physics: {
            enabled: true,
            stabilization: {
              enabled: false, // Disable stabilization after initial setup
            },
            barnesHut: {
              gravitationalConstant: -100, // Slightly higher for better edge response
              centralGravity: 0.02, // Slightly higher for better edge response
              springLength: 300,
              springConstant: 0.005, // Slightly higher so edges respond better to node movement
              damping: 0.9, // High damping but allows some movement for edge rerouting
              avoidOverlap: 1.2,
            },
            maxVelocity: 5, // Slightly higher to allow edge rerouting
            minVelocity: 0.05, // Low but allows continuous edge updates
            solver: 'barnesHut',
            timestep: 0.2, // Faster timestep for smoother edge updates
          },
        });
      }
    });
    
    // Also listen for stabilization progress
    networkInstanceRef.current.on('stabilizationProgress' as any, (params: any) => {
      // If stabilization is taking too long or is complete, switch to minimal physics
      if (params.iterations >= 200 && networkInstanceRef.current && !stabilizationComplete) {
        stabilizationComplete = true;
        networkInstanceRef.current.setOptions({
          physics: {
            enabled: true,
            stabilization: {
              enabled: false,
            },
            barnesHut: {
              gravitationalConstant: -100,
              centralGravity: 0.02,
              springLength: 300,
              springConstant: 0.005,
              damping: 0.9,
              avoidOverlap: 1.2,
            },
            maxVelocity: 5,
            minVelocity: 0.05,
            solver: 'barnesHut',
            timestep: 0.2,
          },
        });
      }
    });
    
    // Add drag event listeners to ensure edges reroute smoothly during node movement
    networkInstanceRef.current.on('dragStart' as any, () => {
      // When dragging starts, ensure physics is active for edge rerouting
      if (networkInstanceRef.current) {
        networkInstanceRef.current.setOptions({
          physics: {
            enabled: true,
            stabilization: { enabled: false },
            barnesHut: {
              gravitationalConstant: -100,
              centralGravity: 0.02,
              springLength: 300,
              springConstant: 0.005,
              damping: 0.9,
              avoidOverlap: 1.2,
            },
            maxVelocity: 5,
            minVelocity: 0.05,
            solver: 'barnesHut',
            timestep: 0.2,
          },
        });
      }
    });
    
    // Force edge redraw when dragging ends to ensure edges are properly rerouted
    networkInstanceRef.current.on('dragEnd' as any, () => {
      if (networkInstanceRef.current) {
        // Trigger a redraw to ensure edges are updated
        networkInstanceRef.current.redraw();
      }
    });
  };

  const updateNetworkVisibility = () => {
    if (!networkInstanceRef.current || !mindMapData) return;

    const { nodes, edges } = buildNetworkData();

    const nodesDataSet = new DataSet(nodes);
    const edgesDataSet = new DataSet(edges);

    networkInstanceRef.current.setData({
      nodes: nodesDataSet,
      edges: edgesDataSet,
    });

    // Ensure minimal physics is enabled for smooth edge rerouting
    networkInstanceRef.current.setOptions({
      physics: {
        enabled: true,
        stabilization: { enabled: false },
        barnesHut: {
          gravitationalConstant: -100,
          centralGravity: 0.02,
          springLength: 300,
          springConstant: 0.005,
          damping: 0.9,
          avoidOverlap: 1.2,
        },
        maxVelocity: 5,
        minVelocity: 0.05,
        solver: 'barnesHut',
        timestep: 0.2,
      },
    });
    
    networkInstanceRef.current.fit({
      animation: false,
    });
  };

  const toggleCategory = (category: keyof typeof visibleCategories) => {
    setVisibleCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setTimeout(() => {
      if (networkInstanceRef.current) {
        // Ensure minimal physics is enabled for smooth edge rerouting
        networkInstanceRef.current.setOptions({
          physics: {
            enabled: true,
            stabilization: { enabled: false },
            barnesHut: {
              gravitationalConstant: -100,
              centralGravity: 0.02,
              springLength: 300,
              springConstant: 0.005,
              damping: 0.9,
              avoidOverlap: 1.2,
            },
            maxVelocity: 5,
            minVelocity: 0.05,
            solver: 'barnesHut',
            timestep: 0.2,
          },
        });
        networkInstanceRef.current.fit({
          animation: false,
        });
      }
    }, 100);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Building mind map...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800 mb-4">{error}</p>
            <button
              onClick={() => navigate(`/matter-reports/${matterId}`)}
              className="text-blue-600 hover:text-blue-800"
            >
              Back to Reports
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-white' : 'min-h-screen bg-gray-50'}`}>
      {/* Header */}
      {!isFullscreen && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <button
              onClick={() => navigate(`/matter-reports/${matterId}`)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Reports
            </button>
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Knowledge Map</h1>
                <p className="text-gray-600 mt-1">{matterName}</p>
              </div>
              <div className="flex gap-4">
                <div className="text-center px-4 py-2 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {mindMapData?.stats.totalCompanies || 0}
                  </div>
                  <div className="text-xs text-gray-600">Companies</div>
                </div>
                <div className="text-center px-4 py-2 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    {mindMapData?.stats.totalPersons || mindMapData?.stats.totalDirectors || 0}
                  </div>
                  <div className="text-xs text-gray-600">Persons</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Panel */}
      {isFullscreen && controlsVisible && (
        <div className="fixed top-5 left-5 right-5 bg-white rounded-lg shadow-lg p-4 z-50 max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-gray-900">Show/Hide Elements</h3>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCategories.companies}
                  onChange={() => toggleCategory('companies')}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Companies</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCategories.persons}
                  onChange={() => toggleCategory('persons')}
                  className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                />
                <span className="text-sm text-gray-700">Persons (Directors/Office Holders/Secretaries)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCategories.shareholders}
                  onChange={() => toggleCategory('shareholders')}
                  className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">Shareholders</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCategories.addresses}
                  onChange={() => toggleCategory('addresses')}
                  className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                />
                <span className="text-sm text-gray-700">Addresses</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCategories.bankruptcies}
                  onChange={() => toggleCategory('bankruptcies')}
                  className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                />
                <span className="text-sm text-gray-700">Bankruptcies</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Network Visualization */}
      <div className={`${isFullscreen ? 'h-screen' : 'h-[800px]'} relative`}>
        <div ref={networkRef} className="w-full h-full bg-white border-2 border-gray-200" />
        
        {/* Custom Tooltip */}
        {tooltip && (
          <div
            className="absolute z-50 bg-gray-900 text-white px-3 py-2 rounded-lg shadow-xl pointer-events-auto max-w-xs text-sm leading-relaxed vis-network-tooltip"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              transform: 'translate(-50%, -100%)',
              marginTop: '-8px',
            }}
            dangerouslySetInnerHTML={{ __html: tooltip.content }}
          />
        )}
        
        {/* Expand/Collapse Button */}
        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 bg-blue-600 text-white p-3 rounded-lg shadow-lg hover:bg-blue-700 transition-colors z-40"
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </button>

        {/* Toggle Controls Button (Fullscreen only) */}
        {isFullscreen && (
          <button
            onClick={() => setControlsVisible(!controlsVisible)}
            className="absolute top-4 left-4 bg-purple-600 text-white p-3 rounded-lg shadow-lg hover:bg-purple-700 transition-colors z-40"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}

        {/* Close Fullscreen Button */}
        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="absolute bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-red-700 transition-colors z-40"
          >
            ✕ Close Fullscreen
          </button>
        )}
      </div>

      {/* Legend */}
      {!isFullscreen && (
        <div className="bg-white border-t border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <h3 className="font-semibold text-gray-900 mb-3">Legend</h3>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-500 rounded"></div>
                <span className="text-sm text-gray-700">Current Company</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-orange-400 rounded-full"></div>
                <span className="text-sm text-gray-700">Person (Director/Office Holder/Secretary)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-400 rounded-full"></div>
                <span className="text-sm text-gray-700">Former Person</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Shareholder</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-orange-500 rounded-full"></div>
                <span className="text-sm text-gray-700">Address</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-600 transform rotate-45"></div>
                <span className="text-sm text-gray-700">Bankruptcy</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-600 transform rotate-45"></div>
                <span className="text-sm text-gray-700">No Bankruptcy</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Edge Styles:</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-0.5 bg-gray-400"></div>
                <span className="text-xs text-gray-600">Solid = Confirmed relationship</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-8 h-0.5 border-t-2 border-dashed border-gray-400"></div>
                <span className="text-xs text-gray-600">Dashed = Former/Ceased relationship</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-8 h-0.5 border-t border-dotted border-gray-400"></div>
                <span className="text-xs text-gray-600">Dotted (XX%) = Probable match with similarity % (name only, no DOB)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MindMap;
