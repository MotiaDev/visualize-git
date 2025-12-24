import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { RepoData, RepoNode, RepoLink, RepoInfo } from '../types';
import { ZoomIn, ZoomOut, Maximize2, Circle, GitBranch, History, X, Layers, Download, TrendingUp, TrendingDown, Minus, Clock, GitPullRequest, AlertCircle, MessageSquare, Calendar, Activity } from 'lucide-react';
import TimelinePlayer, { CommitData } from './TimelinePlayer';
import { fetchStarAnalytics, StarAnalytics, fetchContributions, ContributionStats } from '../services/githubService';

interface VisualizerProps {
  data: RepoData;
  onNodeSelect: (node: RepoNode) => void;
  highlightedNodes?: Set<string>;
  focusNode?: RepoNode | null;
  commits?: CommitData[];
  isLoadingCommits?: boolean;
  onLoadCommits?: () => void;
  repoInfo?: RepoInfo | null;
  token?: string;
}

type LayoutMode = 'force' | 'pack';

// ORIGINAL Force mode colors (simple, clean palette)
const getForceNodeColor = (node: RepoNode): string => {
  if (node.id === 'ROOT') return '#00d4ff';
  if (node.type === 'tree') return '#3b82f6';

  switch (node.extension) {
    case 'ts': case 'tsx': return '#0ea5e9';
    case 'js': case 'jsx': return '#22c55e';
    case 'css': case 'scss': case 'less': return '#06b6d4';
    case 'html': return '#f97316';
    case 'json': case 'yml': case 'yaml': case 'toml': return '#64748b';
    case 'md': case 'mdx': return '#94a3b8';
    case 'py': return '#22c55e';
    case 'go': return '#00bcd4';
    case 'rs': return '#ef4444';
    case 'java': case 'kt': return '#f59e0b';
    default: return '#475569';
  }
};

// GitHub Next-style VIBRANT & VARIED color palette for Pack mode
const PACK_FILE_COLORS: Record<string, string> = {
  // TypeScript - Electric Cyan/Blue
  'ts': '#00d4ff',
  'tsx': '#38bdf8',
  'd.ts': '#7dd3fc',
  // JavaScript - Golden Yellow
  'js': '#fbbf24',
  'jsx': '#fcd34d',
  'mjs': '#f59e0b',
  'cjs': '#d97706',
  // Styles - Hot Pink/Magenta
  'css': '#f472b6',
  'scss': '#ec4899',
  'sass': '#db2777',
  'less': '#e879f9',
  // HTML/Templates - Orange/Coral
  'html': '#fb923c',
  'vue': '#4ade80',
  'svelte': '#ff6b6b',
  // Config/Data - Teal/Aqua
  'json': '#2dd4bf',
  'yml': '#5eead4',
  'yaml': '#14b8a6',
  'toml': '#0d9488',
  'xml': '#06b6d4',
  // Docs - Coral/Salmon (warm, not purple!)
  'md': '#fb7185',
  'mdx': '#fda4af',
  'txt': '#fca5a5',
  // Python - Bright Green
  'py': '#4ade80',
  'pyx': '#86efac',
  // Go - Bright Cyan
  'go': '#22d3ee',
  'mod': '#67e8f9',
  // Rust - Burnt Orange
  'rs': '#ea580c',
  // Java/Kotlin - Warm Amber
  'java': '#fbbf24',
  'kt': '#f59e0b',
  // Ruby - Cherry Red
  'rb': '#f87171',
  'erb': '#fca5a5',
  // PHP - Indigo
  'php': '#818cf8',
  // Shell/Scripts - Lime Green
  'sh': '#a3e635',
  'bash': '#84cc16',
  'zsh': '#65a30d',
  // Images - Emerald/Teal (distinct from code)
  'png': '#34d399',
  'jpg': '#10b981',
  'jpeg': '#10b981',
  'svg': '#6ee7b7',
  'gif': '#059669',
  'ico': '#047857',
  'webp': '#0d9488',
  // Lock/Config - Cool Gray
  'lock': '#64748b',
  'env': '#78716c',
  // Default - Soft lavender
  'default': '#c4b5fd',
};

// Get Pack mode vibrant color (GitHub Next style)
const getPackNodeColor = (node: RepoNode): string => {
  if (node.id === 'ROOT') return '#00d4ff';
  if (node.type === 'tree') return '#1e293b'; // Dark folders
  
  const ext = node.extension?.toLowerCase() || 'default';
  return PACK_FILE_COLORS[ext] || PACK_FILE_COLORS['default'];
};

// Get node size based on type and file size
const getNodeSize = (node: RepoNode): number => {
  if (node.id === 'ROOT') return 18;
  if (node.type === 'tree') return 10;
  
  // Scale file size logarithmically (min 3, max 12)
  if (node.size) {
    const logSize = Math.log10(node.size + 1);
    return Math.min(12, Math.max(3, logSize * 2));
  }
  return 4;
};

// Build hierarchy from flat nodes for circle packing
const buildHierarchy = (nodes: RepoNode[]): d3.HierarchyNode<RepoNode> => {
  const nodeMap = new Map<string, RepoNode>();
  nodes.forEach(n => nodeMap.set(n.id, { ...n, children: [] as RepoNode[] }));
  
  const root = nodeMap.get('ROOT')!;
  
  nodes.forEach(n => {
    if (n.parentId && nodeMap.has(n.parentId)) {
      const parent = nodeMap.get(n.parentId)!;
      if (!parent.children) parent.children = [];
      (parent.children as RepoNode[]).push(nodeMap.get(n.id)!);
    }
  });
  
  return d3.hierarchy(root)
    .sum(d => d.type === 'blob' ? Math.max(d.size || 100, 100) : 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));
};

const Visualizer: React.FC<VisualizerProps> = ({ 
  data, 
  onNodeSelect, 
  highlightedNodes = new Set(),
  focusNode,
  commits = [],
  isLoadingCommits = false,
  onLoadCommits,
  repoInfo,
  token,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simulationRef = useRef<d3.Simulation<RepoNode, RepoLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodesMapRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredPath, setHoveredPath] = useState<Set<string>>(new Set());
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [hoveredNode, setHoveredNode] = useState<RepoNode | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showLayoutToggle, setShowLayoutToggle] = useState(false); // Hidden by default
  const [activeFiles, setActiveFiles] = useState<Set<string>>(new Set());
  const [currentCommit, setCurrentCommit] = useState<CommitData | null>(null);
  const [foldersOnly, setFoldersOnly] = useState(false); // Show only folders for large repos
  const [autoSwitched, setAutoSwitched] = useState(false); // Track if we auto-switched
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['ROOT'])); // Start with only ROOT expanded
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null); // For detail panel

  // Detect mobile viewport
  const isMobile = dimensions.width < 640; // sm breakpoint

  // Check graph size
  const nodeCount = data.nodes.length;
  const isLargeGraph = nodeCount > 600;
  const isMediumGraph = nodeCount > 300;

  // Collapsible mode - manual toggle on desktop, auto for mobile large repos
  const [collapsibleMode, setCollapsibleMode] = useState(false);
  const useCollapsibleMode = collapsibleMode && layoutMode === 'force';

  // Auto-enable Tree mode on mobile for large repos (much cleaner experience)
  useEffect(() => {
    if (isMobile && isLargeGraph && !autoSwitched) {
      setCollapsibleMode(true);
      setExpandedNodes(new Set(['ROOT']));
      setAutoSwitched(true);
    }
  }, [isMobile, isLargeGraph, autoSwitched]);

  // Keyboard navigation state
  const [focusedNodeIndex, setFocusedNodeIndex] = useState<number>(-1);
  const [showHelp, setShowHelp] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [starAnalytics, setStarAnalytics] = useState<StarAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'files' | 'stars'>('files');
  const [contributionStats, setContributionStats] = useState<ContributionStats | null>(null);
  const [isLoadingContributions, setIsLoadingContributions] = useState(false);

  // Fetch star analytics and contributions when dashboard is opened
  useEffect(() => {
    if (showDashboard && repoInfo && !starAnalytics && !isLoadingAnalytics) {
      setIsLoadingAnalytics(true);
      const [owner, repo] = repoInfo.fullName.split('/');
      fetchStarAnalytics(owner, repo, token, false)
        .then(setStarAnalytics)
        .catch(err => console.error('Failed to fetch star analytics:', err))
        .finally(() => setIsLoadingAnalytics(false));
    }
  }, [showDashboard, repoInfo, token, starAnalytics, isLoadingAnalytics]);

  // Auto-load commits and contributions when dashboard is opened
  useEffect(() => {
    if (showDashboard && repoInfo && commits.length === 0 && onLoadCommits && !isLoadingCommits) {
      onLoadCommits();
    }
    if (showDashboard && repoInfo && !contributionStats && !isLoadingContributions) {
      setIsLoadingContributions(true);
      const [owner, repo] = repoInfo.fullName.split('/');
      fetchContributions(owner, repo, token)
        .then(setContributionStats)
        .catch(err => console.error('Failed to fetch contributions:', err))
        .finally(() => setIsLoadingContributions(false));
    }
  }, [showDashboard, repoInfo, commits.length, onLoadCommits, isLoadingCommits, contributionStats, isLoadingContributions, token]);

  // Toggle node expansion
  const toggleNodeExpansion = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        // Collapse: remove this node and all its descendants
        const toRemove = new Set<string>();
        const collectDescendants = (id: string) => {
          data.nodes.forEach(n => {
            if (n.parentId === id) {
              toRemove.add(n.id);
              collectDescendants(n.id);
            }
          });
        };
        collectDescendants(nodeId);
        toRemove.forEach(id => next.delete(id));
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, [data.nodes]);

  // Get children count for a node
  const getChildrenCount = useCallback((nodeId: string): number => {
    return data.nodes.filter(n => n.parentId === nodeId).length;
  }, [data.nodes]);

  // Filter nodes based on mode
  const filteredData = useMemo(() => {
    // Collapsible mode: show ROOT + direct children of expanded nodes
    if (useCollapsibleMode) {
      const visibleNodes: RepoNode[] = [];
      const visibleIds = new Set<string>();

      // Always show ROOT
      const root = data.nodes.find(n => n.id === 'ROOT');
      if (root) {
        visibleNodes.push(root);
        visibleIds.add('ROOT');
      }

      // Show direct children of expanded nodes
      data.nodes.forEach(node => {
        if (node.parentId && expandedNodes.has(node.parentId)) {
          visibleNodes.push(node);
          visibleIds.add(node.id);
        }
      });

      // Filter links to only include visible nodes
      const visibleLinks = data.links.filter(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as RepoNode).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as RepoNode).id;
        return visibleIds.has(sourceId) && visibleIds.has(targetId);
      });

      return { nodes: visibleNodes, links: visibleLinks };
    }

    // Folders only mode
    if (foldersOnly) {
      const folderNodes = data.nodes.filter(n => n.type === 'tree' || n.id === 'ROOT');
      const folderIds = new Set(folderNodes.map(n => n.id));
      const folderLinks = data.links.filter(l => 
        folderIds.has(typeof l.source === 'string' ? l.source : (l.source as RepoNode).id) &&
        folderIds.has(typeof l.target === 'string' ? l.target : (l.target as RepoNode).id)
      );
      
      return { nodes: folderNodes, links: folderLinks };
    }

    // Normal mode: show all nodes
    return data;
  }, [data, foldersOnly, useCollapsibleMode, expandedNodes]);

  // Get the currently focused node (for keyboard navigation)
  const focusedNode = focusedNodeIndex >= 0 && focusedNodeIndex < filteredData.nodes.length 
    ? filteredData.nodes[focusedNodeIndex] 
    : null;

  // Dashboard stats computation
  const dashboardStats = useMemo(() => {
    const allNodes = data.nodes;
    const files = allNodes.filter(n => n.type === 'blob');
    const folders = allNodes.filter(n => n.type === 'tree');
    
    // Language breakdown
    const langCounts: Record<string, number> = {};
    files.forEach(f => {
      const ext = f.extension || 'other';
      langCounts[ext] = (langCounts[ext] || 0) + 1;
    });
    
    // Sort by count descending
    const topLanguages = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    
    // Top folders by children count
    const folderChildCounts: Record<string, number> = {};
    allNodes.forEach(n => {
      if (n.parentId) {
        folderChildCounts[n.parentId] = (folderChildCounts[n.parentId] || 0) + 1;
      }
    });
    
    const topFolders = folders
      .map(f => ({ ...f, childCount: folderChildCounts[f.id] || 0 }))
      .sort((a, b) => b.childCount - a.childCount)
      .slice(0, 6);
    
    // Total size
    const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    
    // Depth analysis
    const depths = allNodes.map(n => n.path.split('/').length);
    const maxDepth = Math.max(...depths, 0);
    const avgDepth = depths.length > 0 ? (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1) : '0';
    
    // Contributor stats from commits
    const contributorCounts: Record<string, { count: number; avatar: string; name: string }> = {};
    if (commits) {
      commits.forEach(c => {
        const key = c.author.email;
        if (!contributorCounts[key]) {
          contributorCounts[key] = { count: 0, avatar: c.author.avatar, name: c.author.name };
        }
        contributorCounts[key].count++;
      });
    }
    const topContributors = Object.values(contributorCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    return {
      totalFiles: files.length,
      totalFolders: folders.length,
      topLanguages,
      topFolders,
      totalSize,
      maxDepth,
      avgDepth,
      topContributors,
      totalCommits: commits?.length || 0,
    };
  }, [data.nodes, commits]);

  // Generate random stars for background
  const stars = useMemo(() => {
    const starAreaWidth = dimensions.width * 5;
    const starAreaHeight = dimensions.height * 5;
    const offsetX = -dimensions.width * 2;
    const offsetY = -dimensions.height * 2;
    
    return Array.from({ length: 500 }).map((_, i) => ({
      id: i,
      x: offsetX + Math.random() * starAreaWidth,
      y: offsetY + Math.random() * starAreaHeight,
      r: Math.random() * 1.2 + 0.2,
      opacity: Math.random() * 0.6 + 0.1,
      blink: Math.random() > 0.85
    }));
  }, [dimensions]);

  // Build path to root for any node
  const getPathToRoot = useCallback((nodeId: string, nodes: RepoNode[]): Set<string> => {
    const path = new Set<string>();
    let current = nodes.find(n => n.id === nodeId);
    while (current) {
      path.add(current.id);
      if (current.parentId) {
        current = nodes.find(n => n.id === current!.parentId);
      } else {
        break;
      }
    }
    path.add('ROOT');
    return path;
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setTransform(event.transform);
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    const initialScale = layoutMode === 'pack' ? 0.9 : 0.75;
    svg.call(zoom.transform, d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(initialScale));

    return () => {
      svg.on('.zoom', null);
    };
  }, [dimensions, layoutMode]);

  // Focus on a specific node
  useEffect(() => {
    if (!focusNode || !svgRef.current || !zoomRef.current) return;
    
    const nodePos = nodesMapRef.current.get(focusNode.id);
    if (nodePos) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(500).call(
        zoomRef.current.transform,
        d3.zoomIdentity
          .translate(dimensions.width / 2 - nodePos.x * 1.5, dimensions.height / 2 - nodePos.y * 1.5)
          .scale(1.5)
      );
    }
  }, [focusNode, dimensions]);

  // New Improved Circle Packing Layout (Monaspace/GitHub Next inspired)
  const renderPackLayout = useCallback(() => {
    if (!filteredData.nodes.length || !gRef.current) return;
    
    const g = d3.select(gRef.current);
    g.selectAll('*').remove();
    
    const hierarchy = buildHierarchy(filteredData.nodes);
    
    // Use most of the viewport for the pack
    const margin = 40;
    const availableSize = Math.min(dimensions.width, dimensions.height) - (margin * 2);
    const size = Math.max(400, availableSize * 0.85); // Use 85% of available space
    
    // More padding between circles for clean look
    const pack = d3.pack<RepoNode>()
      .size([size, size])
      .padding(d => d.depth === 0 ? 20 : 8);
    
    const root = pack(hierarchy);
    
    // Center the pack at origin (0, 0) - zoom transform will position it on screen
    const offsetX = -size / 2;
    const offsetY = -size / 2;
    
    const allNodes = root.descendants();
    
    // Draw Nodes
    const nodeGroups = g.selectAll<SVGGElement, d3.HierarchyCircularNode<RepoNode>>('.pack-node')
      .data(allNodes)
      .enter()
      .append('g')
      .attr('class', 'pack-node')
      .attr('transform', d => `translate(${d.x + offsetX},${d.y + offsetY})`)
      .attr('cursor', 'pointer');

    // Update position map for animations
    allNodes.forEach(d => {
      nodesMapRef.current.set(d.data.id, { x: d.x + offsetX, y: d.y + offsetY });
    });

    // Color palette for folder rings based on depth
    const folderRingColors = [
      '#00d4ff', // cyan - depth 1
      '#4ade80', // green - depth 2
      '#fbbf24', // amber - depth 3
      '#f472b6', // pink - depth 4
      '#818cf8', // indigo - depth 5
      '#fb7185', // coral - depth 6+
    ];
    
    const getFolderRingColor = (depth: number): string => {
      const idx = Math.min(depth - 1, folderRingColors.length - 1);
      return folderRingColors[Math.max(0, idx)];
    };

    // Root: Dark background with glowing cyan border
    nodeGroups.filter(d => d.children && d.depth === 0)
      .append('circle')
      .attr('r', d => d.r)
      .attr('fill', '#0a0f1a')
      .attr('stroke', '#00d4ff')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '8 4');

    // Inner Folders - subtle with colored ring
    nodeGroups.filter(d => d.children && d.depth > 0)
      .append('circle')
      .attr('r', d => d.r)
      .attr('fill', '#0f172a')
      .attr('fill-opacity', 0.3)
      .attr('stroke', d => getFolderRingColor(d.depth))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.35);

    // Files - vibrant dots with subtle glow
    nodeGroups.filter(d => !d.children)
      .append('circle')
      .attr('r', d => Math.max(3, d.r))
      .attr('fill', d => getPackNodeColor(d.data))
      .attr('fill-opacity', 0.9)
      .attr('stroke', d => getPackNodeColor(d.data))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5);

    // Labels for significant groups
    nodeGroups.filter(d => d.children && d.r > 40)
      .each(function(d) {
        const isRoot = d.depth === 0;
        d3.select(this).append('text')
          .attr('dy', isRoot ? d.r + 25 : -d.r + 15)
          .attr('text-anchor', 'middle')
          .attr('font-size', isRoot ? '16px' : '10px')
          .attr('font-weight', isRoot ? '600' : '500')
          .attr('fill', isRoot ? '#00d4ff' : '#94a3b8')
          .attr('pointer-events', 'none')
          .style('text-shadow', '0 1px 4px rgba(0,0,0,0.8)')
          .text(d.data.name);
      });

    // Hover interactions
    nodeGroups
      .on('mouseenter', function(event, d) {
        setHoveredNode(d.data);
        const circle = d3.select(this).select('circle');
        if (d.children) {
          circle.attr('stroke', '#00d4ff').attr('stroke-opacity', 1).attr('stroke-width', 2);
        } else {
          circle.attr('r', Math.max(2, d.r - 1.5) + 2).attr('stroke', '#fff').attr('stroke-width', 2);
        }
      })
      .on('mouseleave', function(event, d) {
        setHoveredNode(null);
        const circle = d3.select(this).select('circle');
        if (d.children) {
          if (d.depth === 0) {
            circle.attr('stroke', '#334155').attr('stroke-width', 1.5);
          } else {
            circle.attr('stroke', '#475569').attr('stroke-opacity', 0.3).attr('stroke-width', 1);
          }
        } else {
          circle.attr('r', Math.max(2, d.r - 1.5)).attr('stroke', 'none');
        }
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d.data);
        onNodeSelect(d.data);
      });
  }, [filteredData, dimensions, onNodeSelect]);

  // Force-Directed Layout
  const renderForceLayout = useCallback(() => {
    if (!filteredData.nodes.length || !gRef.current) return;

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const g = d3.select(gRef.current);
    g.selectAll('*').remove();

    const simNodes: RepoNode[] = filteredData.nodes.map(d => ({ ...d, x: 0, y: 0 }));
    const simLinks: RepoLink[] = filteredData.links.map(d => ({ ...d }));

    // Adaptive force parameters based on graph size
    const currentNodeCount = simNodes.length;
    const isCurrentlyLarge = currentNodeCount > 500;
    const isCurrentlyMedium = currentNodeCount > 200;
    
    // Scale parameters - keep large graphs compact and readable
    const linkDistance = isCurrentlyLarge ? 30 : isCurrentlyMedium ? 32 : 35;
    const linkStrength = isCurrentlyLarge ? 0.6 : isCurrentlyMedium ? 0.55 : 0.5;
    const chargeStrength = isCurrentlyLarge ? -80 : isCurrentlyMedium ? -85 : -90;
    const chargeDistanceMax = isCurrentlyLarge ? 150 : isCurrentlyMedium ? 160 : 180;
    const centeringStrength = isCurrentlyLarge ? 0.08 : isCurrentlyMedium ? 0.05 : 0.03;

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<RepoNode, RepoLink>(simLinks)
        .id(d => d.id)
        .distance(linkDistance)
        .strength(linkStrength))
      .force('charge', d3.forceManyBody()
        .strength(chargeStrength)
        .distanceMax(chargeDistanceMax))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(d => getNodeSize(d as RepoNode) + (isCurrentlyLarge ? 3 : 5)))
      .force('x', d3.forceX(0).strength(centeringStrength))
      .force('y', d3.forceY(0).strength(centeringStrength));

    simulationRef.current = simulation;

    // Links - slightly more subtle for large graphs
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup.selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('class', 'link-line')
      .attr('stroke', '#1e3a5f')
      .attr('stroke-width', isCurrentlyLarge ? 0.6 : isCurrentlyMedium ? 0.7 : 0.8)
      .attr('stroke-opacity', isCurrentlyLarge ? 0.5 : isCurrentlyMedium ? 0.5 : 0.5);

    // Nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup.selectAll<SVGGElement, RepoNode>('g')
      .data(simNodes)
      .join('g')
      .attr('class', d => `node-group node-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`)
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, RepoNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Circles - keep good visibility even for large graphs
    const sizeScale = isCurrentlyLarge ? 0.9 : isCurrentlyMedium ? 0.95 : 1;
    
    node.each(function(d) {
      const color = getForceNodeColor(d);
      const baseSize = getNodeSize(d) || 4; // Fallback to 4 if undefined
      // Keep ROOT and folders at full size for structure visibility
      let size = d.id === 'ROOT' ? baseSize : d.type === 'tree' ? baseSize : baseSize * sizeScale;
      // Ensure size is a valid number
      if (isNaN(size) || size <= 0) size = 4;
      
      const nodeG = d3.select(this);
      
      // Store computed size for later use
      (d as any)._computedSize = size;
      
      if (d.id === 'ROOT') {
        nodeG.append('circle')
          .attr('class', 'glow')
          .attr('r', size + 6)
          .attr('fill', color)
          .attr('opacity', 0.15);
      }
      
      nodeG.append('circle')
        .attr('class', 'node-circle')
        .attr('r', size)
        .attr('fill', color)
        .attr('stroke', d.id === 'ROOT' ? '#00d4ff' : 'transparent')
        .attr('stroke-width', d.id === 'ROOT' ? 2 : 0);
    });

    // Labels for all directories (show all folder names for structure visibility)
    node.filter(d => d.id === 'ROOT' || d.type === 'tree')
      .append('text')
      .attr('class', 'node-label')
      .text(d => d.name)
      .attr('x', 0)
      .attr('y', d => -(((d as any)._computedSize || getNodeSize(d)) + 5))
      .attr('text-anchor', 'middle')
      .attr('font-size', d => d.id === 'ROOT' ? '11px' : isCurrentlyLarge ? '7px' : '8px')
      .attr('font-weight', d => d.id === 'ROOT' ? '600' : '400')
      .attr('fill', '#94a3b8')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('pointer-events', 'none');

    // Hover interactions
    node
      .on('mouseenter', function(event, d) {
        const size = (d as any)._computedSize || getNodeSize(d);
        const pathNodes = getPathToRoot(d.id, simNodes);
        setHoveredPath(pathNodes);
        setHoveredNode(d);
        
        d3.select(this).select('.node-circle')
          .transition()
          .duration(150)
          .attr('r', size * 1.4);
        
        if (d.type === 'blob') {
          d3.select(this)
            .append('text')
            .attr('class', 'hover-label')
            .text(d.name)
            .attr('x', 0)
            .attr('y', -(size + 8))
            .attr('text-anchor', 'middle')
            .attr('font-size', '9px')
            .attr('fill', '#e2e8f0')
            .attr('font-family', 'ui-monospace, monospace')
            .attr('pointer-events', 'none');
        }
      })
      .on('mouseleave', function(event, d) {
        const size = (d as any)._computedSize || getNodeSize(d);
        setHoveredPath(new Set());
        setHoveredNode(null);
        
        d3.select(this).select('.node-circle')
          .transition()
          .duration(150)
          .attr('r', size);
        d3.select(this).select('.hover-label').remove();
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        
        // In collapsible mode, folders toggle expansion
        if (useCollapsibleMode && d.type === 'tree' && getChildrenCount(d.id) > 0) {
          toggleNodeExpansion(d.id);
        }
        
        // Always select for detail panel
        setSelectedNode(d);
        onNodeSelect(d);
      });

    // Add expand/collapse indicators for folders with children (collapsible mode)
    if (useCollapsibleMode) {
      node.filter(d => d.type === 'tree' && getChildrenCount(d.id) > 0)
        .append('text')
        .attr('class', 'expand-indicator')
        .text(d => expandedNodes.has(d.id) ? '−' : '+')
        .attr('x', d => {
          const size = (d as any)._computedSize;
          return (typeof size === 'number' && !isNaN(size) ? size : 10) + 3;
        })
        .attr('y', 4)
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .attr('fill', d => expandedNodes.has(d.id) ? '#f59e0b' : '#22c55e')
        .attr('cursor', 'pointer')
        .attr('pointer-events', 'all');
      
      // Add children count badge
      node.filter(d => d.type === 'tree' && getChildrenCount(d.id) > 0 && !expandedNodes.has(d.id))
        .append('text')
        .attr('class', 'children-count')
        .text(d => `(${getChildrenCount(d.id)})`)
        .attr('x', d => {
          const size = (d as any)._computedSize;
          return (typeof size === 'number' && !isNaN(size) ? size : 10) + 14;
        })
        .attr('y', 4)
        .attr('font-size', '9px')
        .attr('fill', '#64748b')
        .attr('font-family', 'ui-monospace, monospace')
        .attr('pointer-events', 'none');
    }

    simulation.on('tick', () => {
      simNodes.forEach(n => {
        nodesMapRef.current.set(n.id, { x: n.x || 0, y: n.y || 0 });
      });

      link
        .attr('x1', d => (d.source as RepoNode).x || 0)
        .attr('y1', d => (d.source as RepoNode).y || 0)
        .attr('x2', d => (d.target as RepoNode).x || 0)
        .attr('y2', d => (d.target as RepoNode).y || 0);

      node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filteredData, onNodeSelect, getPathToRoot, useCollapsibleMode, expandedNodes, toggleNodeExpansion, getChildrenCount]);

  // Render based on layout mode
  useEffect(() => {
    if (layoutMode === 'pack') {
      renderPackLayout();
    } else {
      renderForceLayout();
    }
  }, [layoutMode, renderPackLayout, renderForceLayout]);

  // Update highlighting based on search/hover (force layout only)
  useEffect(() => {
    if (!gRef.current || layoutMode !== 'force') return;
    const g = d3.select(gRef.current);
    
    const hasHighlight = highlightedNodes.size > 0;
    const hasHover = hoveredPath.size > 0;
    const hasActiveFiles = activeFiles.size > 0;
    
    g.selectAll('.node-group').each(function(d: any) {
      if (!d || !d.id) return;
      
      const isHighlighted = highlightedNodes.has(d.id);
      const isInPath = hoveredPath.has(d.id);
      
      // Check if file was recently changed (for heatmap effect)
      const isActiveFile = d.path && activeFiles.has(d.path);
      
      let opacity = 1;
      if (hasHighlight && !isHighlighted) opacity = 0.2;
      if (hasHover && !isInPath) opacity = 0.3;
      if (hasActiveFiles && !isActiveFile && d.type === 'blob') opacity = 0.25;
      if (isInPath || isHighlighted || isActiveFile) opacity = 1;
      
      // Add glow effect for active files
      const circle = d3.select(this).select('.node-circle');
      if (isActiveFile) {
        circle
          .transition()
          .duration(300)
          .attr('stroke', '#f59e0b')
          .attr('stroke-width', 3)
          .attr('filter', 'url(#glow)');
      } else {
        circle
          .transition()
          .duration(300)
          .attr('stroke', d.id === 'ROOT' ? '#00d4ff' : 'transparent')
          .attr('stroke-width', d.id === 'ROOT' ? 2 : 0)
          .attr('filter', null);
      }
      
      d3.select(this)
        .transition()
        .duration(150)
        .style('opacity', opacity);
    });
    
    // Highlight path links
    g.selectAll('.link-line').each(function(d: any) {
      if (!d || !d.source || !d.target) return;
      
      const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
      const targetId = typeof d.target === 'object' ? d.target.id : d.target;
      const isInPath = hoveredPath.has(sourceId) && hoveredPath.has(targetId);
      
      d3.select(this)
        .transition()
        .duration(150)
        .attr('stroke', isInPath ? '#00d4ff' : '#1e3a5f')
        .attr('stroke-width', isInPath ? 1.5 : 0.8)
        .attr('stroke-opacity', isInPath ? 1 : 0.5);
    });
  }, [highlightedNodes, hoveredPath, layoutMode, activeFiles]);

  // Gource-style live commit animation
  useEffect(() => {
    if (!currentCommit || !gRef.current || !svgRef.current || !zoomRef.current) return;

    // Log animation info for debugging
    console.log('[Gource] Commit:', currentCommit.sha.substring(0, 7), 
      '| Files:', currentCommit.files.length, 
      '| Layout:', layoutMode,
      '| Nodes:', nodesMapRef.current.size);

    const g = d3.select(gRef.current);
    
    // Get current transform to calculate positions
    const transform = d3.zoomTransform(svgRef.current);
    
    // Author position - bottom-left of visible area, converted to SVG coordinates
    const screenX = 80;
    const screenY = dimensions.height - 200;
    const [startX, startY] = transform.invert([screenX, screenY]);
    
    // Remove any existing avatar
    g.selectAll('.commit-avatar').remove();
    
    // Add author avatar at the source of projectiles (inside SVG)
    if (currentCommit.author.avatar) {
      const avatarSize = 24 / transform.k; // Scale inversely to zoom
      
      // Create avatar group
      const avatarGroup = g.append('g')
        .attr('class', 'commit-avatar')
        .attr('transform', `translate(${startX}, ${startY})`);
      
      // Glow behind avatar
      avatarGroup.append('circle')
        .attr('r', avatarSize + 4)
        .attr('fill', '#f59e0b')
        .attr('opacity', 0.4)
        .attr('filter', 'url(#glow)');
      
      // Clip path for circular avatar
      const clipId = `avatar-clip-${currentCommit.sha.substring(0, 7)}`;
      avatarGroup.append('clipPath')
        .attr('id', clipId)
        .append('circle')
        .attr('r', avatarSize);
      
      // Avatar image
      avatarGroup.append('image')
        .attr('href', currentCommit.author.avatar)
        .attr('x', -avatarSize)
        .attr('y', -avatarSize)
        .attr('width', avatarSize * 2)
        .attr('height', avatarSize * 2)
        .attr('clip-path', `url(#${clipId})`)
        .attr('opacity', 1);
      
      // Border around avatar
      avatarGroup.append('circle')
        .attr('r', avatarSize)
        .attr('fill', 'none')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 2 / transform.k);
      
      // Fade out avatar after animation completes
      avatarGroup.transition()
        .delay(1500)
        .duration(500)
        .attr('opacity', 0)
        .remove();
    }

    currentCommit.files.forEach(file => {
      // Find the node for this file using multiple matching strategies
      let targetNode: { x: number, y: number } | undefined;
      
      // Try to find the matching node - file.filename might be like "src/github/file.ts"
      // node.path might be like "src/github/file.ts" or "github/file.ts" or just "file.ts"
      const filename = file.filename;
      const filenameOnly = filename.split('/').pop() || filename;
      
      // IMPORTANT: Only search in VISIBLE nodes (filteredData), not all nodes
      // This prevents projectiles going to invisible nodes in Tree/Folders mode
      const node = filteredData.nodes.find(n => {
        if (!n.path) return false;
        // Exact match
        if (n.path === filename) return true;
        // Match without leading slash
        if (n.path === filename.replace(/^\//, '') || filename === n.path.replace(/^\//, '')) return true;
        // Match by filename only (for files in different directory representations)
        const nodeName = n.path.split('/').pop() || n.path;
        if (nodeName === filenameOnly && n.type === 'blob') return true;
        return false;
      });
      
      // If file not visible, try to find its visible parent folder
      if (!node && (collapsibleMode || foldersOnly)) {
        // Find the closest visible parent folder
        const pathParts = filename.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
          const parentPath = pathParts.slice(0, i).join('/');
          const parentNode = filteredData.nodes.find(n => 
            n.type === 'tree' && (n.path === parentPath || n.path === '/' + parentPath)
          );
          if (parentNode) {
            const pos = nodesMapRef.current.get(parentNode.id);
            if (pos && isFinite(pos.x) && isFinite(pos.y)) {
              targetNode = pos;
              break;
            }
          }
        }
      }
      
      // Use nodesMapRef for both force and pack layouts (it stores current positions)
      if (node) {
        const pos = nodesMapRef.current.get(node.id);
        // Verify position is valid (not NaN or undefined)
        if (pos && isFinite(pos.x) && isFinite(pos.y)) {
          targetNode = pos;
        } else {
          console.log('[Gource] Invalid position for node:', node.id, pos);
        }
      }

      if (targetNode) {
        // Calculate distance for animation timing
        const distance = Math.sqrt(Math.pow(targetNode.x - startX, 2) + Math.pow(targetNode.y - startY, 2));
        const duration = Math.min(800, Math.max(300, distance * 0.5));
        
        // Create glowing trail line first (will be under the projectile)
        const trail = g.append('line')
          .attr('x1', startX)
          .attr('y1', startY)
          .attr('x2', startX)
          .attr('y2', startY)
          .attr('stroke', '#f59e0b')
          .attr('stroke-width', 2)
          .attr('opacity', 0.6)
          .attr('filter', 'url(#glow)');
        
        // Animate trail to follow projectile
        trail.transition()
          .duration(duration)
          .ease(d3.easeLinear)
          .attr('x2', targetNode.x)
          .attr('y2', targetNode.y)
          .transition()
          .duration(300)
          .attr('opacity', 0)
          .remove();

        // Create projectile (larger and brighter)
        const projectile = g.append('circle')
          .attr('cx', startX)
          .attr('cy', startY)
          .attr('r', 6)
          .attr('fill', '#fbbf24')
          .attr('filter', 'url(#glow)')
          .attr('opacity', 1);

        // Animate projectile
        projectile.transition()
          .duration(duration)
          .ease(d3.easeQuadOut)
          .attr('cx', targetNode.x)
          .attr('cy', targetNode.y)
          .attr('r', 4)
          .on('end', function() {
            // Remove projectile
            d3.select(this).remove();
            
            // Create multiple explosion rings for impact effect
            for (let i = 0; i < 3; i++) {
              const explosion = g.append('circle')
                .attr('cx', targetNode!.x)
                .attr('cy', targetNode!.y)
                .attr('r', 3)
                .attr('fill', 'none')
                .attr('stroke', i === 0 ? '#fbbf24' : i === 1 ? '#f59e0b' : '#ea580c')
                .attr('stroke-width', 3 - i)
                .attr('opacity', 1);
              
              explosion.transition()
                .delay(i * 80)
                .duration(600)
                .ease(d3.easeOut)
                .attr('r', 35 - (i * 8))
                .attr('opacity', 0)
                .attr('stroke-width', 0)
                .remove();
            }
            
            // Flash the target node briefly
            const flash = g.append('circle')
              .attr('cx', targetNode!.x)
              .attr('cy', targetNode!.y)
              .attr('r', 12)
              .attr('fill', '#fbbf24')
              .attr('opacity', 0.8)
              .attr('filter', 'url(#glow)');
              
            flash.transition()
              .duration(400)
              .attr('opacity', 0)
              .attr('r', 8)
              .remove();
          });
      } // else: node not found in visualization (might be beyond the 200 node limit)
    });
  }, [currentCommit, dimensions, layoutMode, filteredData, collapsibleMode, foldersOnly]);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 1.4);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const handleReset = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const initialScale = layoutMode === 'pack' ? 0.9 : 0.75;
    d3.select(svgRef.current).transition().duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(initialScale));
  }, [dimensions, layoutMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setFocusedNodeIndex(prev => {
            const next = prev + 1;
            return next >= filteredData.nodes.length ? 0 : next;
          });
          break;

        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setFocusedNodeIndex(prev => {
            const next = prev - 1;
            return next < 0 ? filteredData.nodes.length - 1 : next;
          });
          break;

        case 'Enter':
          e.preventDefault();
          if (focusedNode) {
            setSelectedNode(focusedNode);
            onNodeSelect(focusedNode);
            // If it's a folder in tree mode, expand it
            if (useCollapsibleMode && focusedNode.type === 'tree' && getChildrenCount(focusedNode.id) > 0) {
              toggleNodeExpansion(focusedNode.id);
            }
          }
          break;

        case 'Escape':
          e.preventDefault();
          if (showDashboard) {
            setShowDashboard(false);
          } else if (showHelp) {
            setShowHelp(false);
          } else if (selectedNode) {
            setSelectedNode(null);
          } else {
            setFocusedNodeIndex(-1);
          }
          break;

        case '?':
          e.preventDefault();
          setShowHelp(prev => !prev);
          break;

        case 't':
          // Toggle tree mode
          if (layoutMode === 'force') {
            e.preventDefault();
            setCollapsibleMode(prev => !prev);
            if (!collapsibleMode) {
              setExpandedNodes(new Set(['ROOT']));
            }
          }
          break;

        case 'p':
          // Toggle pack mode
          e.preventDefault();
          setLayoutMode(prev => prev === 'pack' ? 'force' : 'pack');
          break;

        case 'f':
          // Focus search (handled by App.tsx, but prevent default)
          break;

        case 'g':
          // Toggle view options
          e.preventDefault();
          setShowLayoutToggle(prev => !prev);
          break;

        case 'd':
          // Toggle dashboard
          e.preventDefault();
          setShowDashboard(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredData.nodes.length, focusedNode, selectedNode, showHelp, showDashboard, useCollapsibleMode, layoutMode, collapsibleMode, onNodeSelect, getChildrenCount, toggleNodeExpansion]);

  // Highlight focused node visually
  useEffect(() => {
    if (!gRef.current || focusedNodeIndex < 0) return;
    
    const g = d3.select(gRef.current);
    // Remove previous focus highlight
    g.selectAll('.focus-ring').remove();
    
    if (focusedNode) {
      const pos = nodesMapRef.current.get(focusedNode.id);
      if (pos && isFinite(pos.x) && isFinite(pos.y)) {
        // Add focus ring
        g.append('circle')
          .attr('class', 'focus-ring')
          .attr('cx', pos.x)
          .attr('cy', pos.y)
          .attr('r', 20)
          .attr('fill', 'none')
          .attr('stroke', '#f59e0b')
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '4,2')
          .attr('opacity', 0.8);
      }
    }
  }, [focusedNodeIndex, focusedNode]);

  // Extended bounds for zoom-out
  const extendedBounds = useMemo(() => {
    const extend = 5;
    return {
      x: -dimensions.width * (extend / 2),
      y: -dimensions.height * (extend / 2),
      width: dimensions.width * extend,
      height: dimensions.height * extend,
    };
  }, [dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#050810]">
      <svg 
        ref={svgRef} 
        className="w-full h-full"
        width={dimensions.width}
        height={dimensions.height}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <radialGradient id="space-bg" cx="50%" cy="50%" r="80%">
            <stop offset="0%" stopColor="#0d1424" />
            <stop offset="60%" stopColor="#0a0f1a" />
            <stop offset="100%" stopColor="#050810" />
          </radialGradient>
          {/* Glow filter for active files (heatmap) */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <rect 
          x={extendedBounds.x} 
          y={extendedBounds.y} 
          width={extendedBounds.width} 
          height={extendedBounds.height} 
          fill="#050810" 
          style={{ pointerEvents: 'none' }} 
        />
        <rect width="100%" height="100%" fill="url(#space-bg)" style={{ pointerEvents: 'none' }} />
        
        <g style={{ pointerEvents: 'none' }}>
          {stars.map((star) => (
            <circle 
              key={star.id}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill="#ffffff"
              opacity={star.opacity}
              style={{ pointerEvents: 'none' }}
              className={star.blink ? "animate-pulse" : ""}
            />
          ))}
        </g>

        <g ref={gRef} style={{ pointerEvents: 'all' }} />
      </svg>
      
      {/* View Options - Positioned at bottom-left to avoid header overlap */}
      <div className="absolute bottom-20 sm:bottom-4 left-2 sm:left-4 z-30 flex items-center gap-1 sm:gap-2" style={{ pointerEvents: 'auto' }}>
        {/* Simple view mode toggle - only show when expanded */}
        {showLayoutToggle ? (
          <div className="flex gap-1 bg-[#0d1424] border border-[#1e3a5f] rounded-lg p-1 shadow-lg">
            <button 
              onClick={() => setLayoutMode('force')}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                layoutMode === 'force' 
                  ? 'bg-[#00d4ff] text-[#0d1424]' 
                  : 'text-[#64748b] hover:text-white hover:bg-[#1e3a5f]'
              }`}
              title="Force-directed graph (default)"
            >
              <GitBranch size={12} />
              <span className="hidden sm:inline text-[10px]">Force</span>
            </button>
            <button 
              onClick={() => setLayoutMode('pack')}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                layoutMode === 'pack' 
                  ? 'bg-[#00d4ff] text-[#0d1424]' 
                  : 'text-[#64748b] hover:text-white hover:bg-[#1e3a5f]'
              }`}
              title="Circle packing layout"
            >
              <Circle size={12} />
              <span className="hidden sm:inline text-[10px]">Pack</span>
            </button>
            {/* Mode toggles - show based on layout */}
            {layoutMode === 'force' && (
              <div className="border-l border-[#1e3a5f] ml-1 pl-2 flex gap-1">
                {/* Collapsible mode toggle */}
                <button 
                  onClick={() => {
                    setCollapsibleMode(!collapsibleMode);
                    if (!collapsibleMode) {
                      setExpandedNodes(new Set(['ROOT'])); // Start collapsed
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    collapsibleMode 
                      ? 'bg-[#8b5cf6] text-white' 
                      : 'text-[#64748b] hover:text-white hover:bg-[#1e3a5f]'
                  }`}
                  title="Toggle collapsible mode - click folders to expand/collapse"
                >
                  🌳
                  <span className="hidden sm:inline">Tree</span>
                </button>
                
                {/* Folders only toggle */}
                {!collapsibleMode && (
                  <button 
                    onClick={() => setFoldersOnly(!foldersOnly)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      foldersOnly 
                        ? 'bg-[#22c55e] text-[#0d1424]' 
                        : 'text-[#64748b] hover:text-white hover:bg-[#1e3a5f]'
                    }`}
                    title="Show folders only"
                  >
                    📁
                    <span className="hidden sm:inline">Folders</span>
                  </button>
                )}

                {/* Collapsible mode controls */}
                {collapsibleMode && (
                  <>
                    <button 
                      onClick={() => {
                        const firstLevel = new Set(['ROOT']);
                        data.nodes.filter(n => n.parentId === 'ROOT').forEach(n => firstLevel.add(n.id));
                        setExpandedNodes(firstLevel);
                      }}
                      className="px-2 py-1 rounded text-[10px] font-medium text-[#64748b] hover:text-white hover:bg-[#1e3a5f] transition-colors"
                      title="Expand first level"
                    >
                      +1
                    </button>
                    <button 
                      onClick={() => setExpandedNodes(new Set(['ROOT']))}
                      className="px-2 py-1 rounded text-[10px] font-medium text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors"
                      title="Collapse all"
                    >
                      ⟲
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (!showTimeline && commits.length === 0 && onLoadCommits) {
                  onLoadCommits();
                }
                setShowTimeline(!showTimeline);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                showTimeline 
                  ? 'bg-[#f59e0b] text-[#0d1424]' 
                  : 'text-[#64748b] hover:text-white hover:bg-[#1e3a5f]'
              }`}
              title="Git history timeline"
            >
              <History size={12} />
              <span className="hidden sm:inline text-[10px]">Timeline</span>
            </button>
            <button
              onClick={() => setShowLayoutToggle(false)}
              className="px-1.5 py-1 text-[#64748b] hover:text-white"
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowLayoutToggle(true)}
              className="p-2.5 bg-[#0d1424] border border-[#1e3a5f] rounded-lg text-[#64748b] hover:text-[#00d4ff] hover:bg-[#1e3a5f] hover:border-[#00d4ff] transition-colors shadow-lg cursor-pointer"
              title="View options (layouts, timeline)"
              style={{ pointerEvents: 'auto' }}
            >
              <Layers size={16} />
            </button>
            <button
              onClick={() => setShowDashboard(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-[#0d1424] border border-[#1e3a5f] rounded-lg text-[11px] text-[#94a3b8] hover:border-[#00d4ff] hover:text-[#00d4ff] transition-all shadow-lg"
              title="Repository Dashboard"
            >
              <span>📊</span>
              <span>Dashboard</span>
              <kbd className="px-1 py-0.5 bg-[#1e3a5f] rounded text-[#64748b] font-mono text-[9px]">d</kbd>
            </button>
          </>
        )}
      </div>

      {/* Hovered Node Info - positioned below header with high z-index */}
      {/* Hovered node tooltip - positioned in middle of screen */}
      {hoveredNode && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0d1424]/95 border border-[#1e3a5f] rounded-lg px-3 py-2 pointer-events-none z-30 shadow-lg max-w-[90vw]">
          <div className="flex items-center gap-2">
            <span 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: layoutMode === 'pack' ? getPackNodeColor(hoveredNode) : getForceNodeColor(hoveredNode) }}
            />
            <span className="text-sm text-white font-mono">{hoveredNode.name}</span>
            {hoveredNode.size && (
              <span className="text-xs text-[#64748b]">
                {hoveredNode.size > 1024 
                  ? `${(hoveredNode.size / 1024).toFixed(1)} KB` 
                  : `${hoveredNode.size} B`}
              </span>
            )}
                     </div>
          {hoveredNode.path && (
            <div className="text-xs text-[#64748b] mt-1 font-mono truncate max-w-[300px]">
              {hoveredNode.path}
            </div>
          )}
        </div>
      )}

      
      {/* Zoom Controls - positioned above keyboard hint, shifts left when sidebar open */}
      <div className={`absolute bottom-12 flex flex-col gap-1 z-20 transition-all ${selectedNode ? 'right-80' : 'right-4'}`}>
        <button onClick={handleZoomIn} className="p-2 bg-[#0d1424] hover:bg-[#1a2744] border border-[#1e3a5f] rounded text-[#64748b] hover:text-[#00d4ff] transition-colors">
          <ZoomIn size={16} />
        </button>
        <button onClick={handleZoomOut} className="p-2 bg-[#0d1424] hover:bg-[#1a2744] border border-[#1e3a5f] rounded text-[#64748b] hover:text-[#00d4ff] transition-colors">
          <ZoomOut size={16} />
        </button>
        <button onClick={handleReset} className="p-2 bg-[#0d1424] hover:bg-[#1a2744] border border-[#1e3a5f] rounded text-[#64748b] hover:text-[#00d4ff] transition-colors">
          <Maximize2 size={16} />
        </button>
      </div>

      {/* Detail Panel - Bottom sheet on mobile, right sidebar on desktop */}
      {selectedNode && (
        <div className="absolute sm:top-0 sm:right-0 sm:h-full sm:w-80 bottom-0 left-0 right-0 h-[50vh] sm:bottom-auto sm:left-auto bg-[#0a0f1a]/95 border-t sm:border-t-0 sm:border-l border-[#1e3a5f] z-40 overflow-y-auto backdrop-blur-sm rounded-t-xl sm:rounded-none">
          {/* Mobile drag handle */}
          <div className="sm:hidden flex justify-center py-2">
            <div className="w-10 h-1 bg-[#475569] rounded-full" />
          </div>
          {/* Header */}
          <div className="sticky top-0 bg-[#0a0f1a]/95 border-b border-[#1e3a5f] p-3 sm:p-4 pt-0 sm:pt-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div 
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: layoutMode === 'pack' ? getPackNodeColor(selectedNode) : getForceNodeColor(selectedNode) }}
                />
                <div>
                  <h3 className="text-white font-semibold text-sm truncate max-w-[180px]">{selectedNode.name}</h3>
                  <p className="text-[10px] text-[#64748b] font-mono truncate max-w-[180px]">{selectedNode.path}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedNode(null)}
                className="p-1 text-[#64748b] hover:text-white hover:bg-[#1e3a5f] rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            {/* Type badge */}
            <div className="flex items-center gap-2 mt-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                selectedNode.type === 'tree' 
                  ? 'bg-[#3b82f6]/20 text-[#3b82f6]' 
                  : 'bg-[#22c55e]/20 text-[#22c55e]'
              }`}>
                {selectedNode.type === 'tree' ? '📁 Folder' : '📄 File'}
              </span>
              {selectedNode.extension && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#00d4ff]/20 text-[#00d4ff]">
                  .{selectedNode.extension}
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {selectedNode.size && (
                <div className="bg-[#0d1424] border border-[#1e3a5f] rounded-lg p-3">
                  <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Size</div>
                  <div className="text-lg font-semibold text-white">
                    {selectedNode.size > 1024 
                      ? `${(selectedNode.size / 1024).toFixed(1)} KB` 
                      : `${selectedNode.size} B`}
                  </div>
                </div>
              )}
              {selectedNode.type === 'tree' && (
                <div className="bg-[#0d1424] border border-[#1e3a5f] rounded-lg p-3">
                  <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Children</div>
                  <div className="text-lg font-semibold text-white">{getChildrenCount(selectedNode.id)}</div>
                </div>
              )}
              <div className="bg-[#0d1424] border border-[#1e3a5f] rounded-lg p-3">
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Depth</div>
                <div className="text-lg font-semibold text-white">
                  {selectedNode.path.split('/').filter(Boolean).length}
                </div>
              </div>
            </div>

            {/* Expand/Collapse for folders */}
            {selectedNode.type === 'tree' && getChildrenCount(selectedNode.id) > 0 && useCollapsibleMode && (
              <button
                onClick={() => toggleNodeExpansion(selectedNode.id)}
                className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  expandedNodes.has(selectedNode.id)
                    ? 'bg-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/30'
                    : 'bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30'
                }`}
              >
                {expandedNodes.has(selectedNode.id) ? '➖ Collapse Folder' : `➕ Expand Folder (${getChildrenCount(selectedNode.id)} items)`}
              </button>
            )}

            {/* Children preview (if folder and expanded) */}
            {selectedNode.type === 'tree' && expandedNodes.has(selectedNode.id) && (
              <div>
                <h4 className="text-xs font-medium text-[#94a3b8] mb-2">Contents</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {data.nodes
                    .filter(n => n.parentId === selectedNode.id)
                    .slice(0, 15)
                    .map(child => (
                      <button
                        key={child.id}
                        onClick={() => setSelectedNode(child)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[#1e3a5f] transition-colors"
                      >
                        <span 
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: layoutMode === 'pack' ? getPackNodeColor(child) : getForceNodeColor(child) }}
                        />
                        <span className="text-xs text-[#e2e8f0] truncate">{child.name}</span>
                        {child.type === 'tree' && (
                          <span className="text-[10px] text-[#64748b] ml-auto">📁</span>
                        )}
                      </button>
                    ))
                  }
                  {data.nodes.filter(n => n.parentId === selectedNode.id).length > 15 && (
                    <div className="text-[10px] text-[#64748b] text-center py-1">
                      +{data.nodes.filter(n => n.parentId === selectedNode.id).length - 15} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Path breadcrumb */}
            <div>
              <h4 className="text-xs font-medium text-[#94a3b8] mb-2">Path</h4>
              <div className="flex flex-wrap gap-1">
                {selectedNode.path.split('/').filter(Boolean).map((part, i, arr) => (
                  <span key={i} className="inline-flex items-center">
                    <span className="text-[11px] text-[#64748b] font-mono bg-[#1e3a5f]/50 px-1.5 py-0.5 rounded">
                      {part}
                    </span>
                    {i < arr.length - 1 && <span className="text-[#475569] mx-1">/</span>}
                  </span>
                ))}
              </div>
            </div>

            {/* Graph Metrics placeholder - future feature */}
            <div className="border-t border-[#1e3a5f] pt-4">
              <h4 className="text-xs font-medium text-[#94a3b8] mb-3">Graph Metrics</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64748b]">PageRank</span>
                  <span className="text-[#00d4ff] font-mono">—</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64748b]">Betweenness</span>
                  <span className="text-[#00d4ff] font-mono">—</span>
                </div>
                <div className="text-[10px] text-[#475569] italic mt-2">
                  Coming soon: File importance metrics
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend - Only show when View Options panel is expanded, positioned above it */}
      <div className={`absolute bottom-28 sm:bottom-16 left-4 bg-[#0d1424]/90 border border-[#1e3a5f] rounded px-2 py-1.5 z-10 transition-all ${showLayoutToggle ? 'block' : 'hidden'}`}>
        {layoutMode === 'force' ? (
          /* Force mode: Original simple colors */
          <div className="text-[10px] text-[#64748b] space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00d4ff]" />
              <span>Root</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
              <span>Directory</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />
              <span>TypeScript</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span>JavaScript</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#475569]" />
              <span>Other</span>
            </div>
          </div>
        ) : (
          /* Pack mode: GitHub Next vibrant colors */
          <div className="text-[10px] text-[#94a3b8] space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00d4ff]" />
              <span>TypeScript</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#fbbf24]" />
              <span>JavaScript</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f472b6]" />
              <span>Styles</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#fb7185]" />
              <span>Docs</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2dd4bf]" />
              <span>Config</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#34d399]" />
              <span>Images</span>
            </div>
          </div>
        )}
      </div>

      {/* Tip for large repos - positioned at bottom above View Options */}
      {isLargeGraph && !collapsibleMode && layoutMode === 'force' && !showLayoutToggle && (
        <div className="absolute bottom-32 sm:bottom-16 left-4 z-20 max-w-xs hidden sm:block">
          <div className="bg-[#0d1424]/95 border border-[#f59e0b]/50 rounded-lg px-3 py-2 text-[10px]">
            <span className="text-[#f59e0b] font-medium">💡 Large repo ({nodeCount} files)</span>
            <span className="text-[#94a3b8]"> — Try </span>
            <button 
              onClick={() => {
                setShowLayoutToggle(true);
                setCollapsibleMode(true);
                setExpandedNodes(new Set(['ROOT']));
              }}
              className="text-[#8b5cf6] hover:underline font-medium"
            >
              🌳 Tree mode
            </button>
            <span className="text-[#94a3b8]"> to explore step by step.</span>
          </div>
        </div>
      )}

      {/* Tip when in collapsible mode - positioned at bottom above View Options */}
      {collapsibleMode && expandedNodes.size <= 1 && !showLayoutToggle && (
        <div className="absolute bottom-32 sm:bottom-16 left-4 z-20 max-w-xs hidden sm:block">
          <div className="bg-[#0d1424]/95 border border-[#8b5cf6]/50 rounded-lg px-3 py-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="text-lg">🌳</span>
              <div>
                <span className="text-[#8b5cf6] font-semibold text-[11px]">Tree Mode</span>
                <p className="text-[#94a3b8] mt-0.5 leading-relaxed text-[10px]">
                  Click <span className="text-[#22c55e] font-mono">+</span> on folders to expand, 
                  or click any node for details.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="absolute bottom-4 left-4 text-[10px] text-[#475569] font-mono hidden sm:block">
        {filteredData.nodes.length} nodes · {filteredData.links.length} edges · {Math.round(transform.k * 100)}%
        {layoutMode === 'pack' ? ' · Pack' : ' · Force'}
        {collapsibleMode && ` · 🌳 Tree (${expandedNodes.size} open)`}
        {foldersOnly && !collapsibleMode && ' · Folders Only'}
      </div>

      {/* Mobile Mode Bar - Simple mode switcher for mobile */}
      <div className="absolute bottom-20 left-2 right-2 sm:hidden">
        <div className="flex items-center justify-between bg-[#0d1424]/95 border border-[#1e3a5f] rounded-lg px-3 py-2">
          {/* Current mode info */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#64748b]">
              {collapsibleMode ? '🌳 Tree' : layoutMode === 'pack' ? '📦 Pack' : '⚡ Force'}
            </span>
            <span className="text-[10px] text-[#475569]">
              {filteredData.nodes.length} nodes
            </span>
          </div>
          
          {/* Quick mode toggles */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDashboard(true)}
              className="px-2 py-1 rounded text-[10px] font-medium bg-[#1e3a5f] text-[#94a3b8]"
            >
              📊
            </button>
            <button
              onClick={() => {
                if (collapsibleMode) {
                  setCollapsibleMode(false);
                } else {
                  setCollapsibleMode(true);
                  setExpandedNodes(new Set(['ROOT']));
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium ${
                collapsibleMode ? 'bg-[#8b5cf6] text-white' : 'bg-[#1e3a5f] text-[#94a3b8]'
              }`}
            >
              🌳
            </button>
            <button
              onClick={() => setLayoutMode(layoutMode === 'pack' ? 'force' : 'pack')}
              className={`px-2 py-1 rounded text-[10px] font-medium ${
                layoutMode === 'pack' ? 'bg-[#00d4ff] text-[#0d1424]' : 'bg-[#1e3a5f] text-[#94a3b8]'
              }`}
            >
              📦
            </button>
          </div>
        </div>
        
        {/* Tree mode tip on mobile */}
        {collapsibleMode && (
          <div className="mt-1 text-center text-[9px] text-[#64748b]">
            Tap <span className="text-[#22c55e]">+</span> on folders to expand
          </div>
        )}
      </div>

      {/* Desktop Legend - hidden on mobile */}
      <div className="absolute bottom-24 left-2 hidden">
        <div className="flex flex-wrap items-center gap-2 bg-[#0d1424]/90 border border-[#1e3a5f] rounded-lg px-2 py-1.5 max-w-[200px]">
          {layoutMode === 'force' ? (
            <>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#00d4ff]" />
                <span className="text-[8px] text-[#64748b]">Root</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                <span className="text-[8px] text-[#64748b]">Folder</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />
                <span className="text-[8px] text-[#64748b]">TS</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                <span className="text-[8px] text-[#64748b]">JS</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#00d4ff]" />
                <span className="text-[8px] text-[#94a3b8]">TS</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                <span className="text-[8px] text-[#94a3b8]">JS</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#f472b6]" />
                <span className="text-[8px] text-[#94a3b8]">CSS</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#fb7185]" />
                <span className="text-[8px] text-[#94a3b8]">MD</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Timeline Panel (Gource-style git history) - higher z-index to avoid overlap */}
      {showTimeline && (
        <div className="absolute bottom-24 sm:bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-[400px] z-50">
          <div className="relative bg-[#0a0f1a] border border-[#1e3a5f] rounded-lg shadow-2xl">
            <button
              onClick={() => setShowTimeline(false)}
              className="absolute -top-2 -right-2 p-1.5 bg-[#f59e0b] hover:bg-[#d97706] rounded-full text-[#0d1424] z-10 shadow-lg"
            >
              <X size={12} />
            </button>
            <TimelinePlayer
              commits={commits}
              onCommitChange={setCurrentCommit}
              onFilesActive={setActiveFiles}
              isLoading={isLoadingCommits}
            />
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div 
            className="bg-[#0a0f1a] border border-[#1e3a5f] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">⌨️ Keyboard Shortcuts</h2>
              <button 
                onClick={() => setShowHelp(false)}
                className="p-1 text-[#64748b] hover:text-white hover:bg-[#1e3a5f] rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Navigation */}
              <div>
                <h3 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">Navigation</h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Next node</span>
                    <div className="flex gap-1">
                      <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">j</kbd>
                      <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">↓</kbd>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Previous node</span>
                    <div className="flex gap-1">
                      <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">k</kbd>
                      <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">↑</kbd>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Select / Expand</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Close / Deselect</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">Esc</kbd>
                  </div>
                </div>
              </div>

              {/* View Controls */}
              <div>
                <h3 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">View Controls</h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Toggle Tree mode</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#8b5cf6] font-mono text-xs">t</kbd>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Toggle Pack view</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#22c55e] font-mono text-xs">p</kbd>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Show view options</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#f59e0b] font-mono text-xs">g</kbd>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Open dashboard</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-[#00d4ff] font-mono text-xs">d</kbd>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#94a3b8]">Show this help</span>
                    <kbd className="px-2 py-0.5 bg-[#1e3a5f] rounded text-white font-mono text-xs">?</kbd>
                  </div>
                </div>
              </div>

              {/* Mouse Controls */}
              <div>
                <h3 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">Mouse Controls</h3>
                <div className="space-y-1.5 text-sm text-[#94a3b8]">
                  <div>• Scroll to zoom in/out</div>
                  <div>• Drag to pan the view</div>
                  <div>• Drag nodes to reposition</div>
                  <div>• Click node to see details</div>
                  <div>• Hover to see path to root</div>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#1e3a5f] text-center">
              <span className="text-xs text-[#64748b]">Press <kbd className="px-1.5 py-0.5 bg-[#1e3a5f] rounded text-white font-mono text-[10px]">?</kbd> anytime to toggle this help</span>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Modal */}
      {showDashboard && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm p-2 sm:p-4"
          onClick={() => setShowDashboard(false)}
        >
          <div 
            className="bg-[#0a0f1a] border border-[#1e3a5f] rounded-xl p-3 sm:p-6 max-w-3xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-xl font-bold text-white">📊 Repository Dashboard</h2>
              <button 
                onClick={() => setShowDashboard(false)}
                className="p-1.5 text-[#64748b] hover:text-white hover:bg-[#1e3a5f] rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 sm:mb-5 p-1 bg-[#1e3a5f]/30 rounded-lg w-fit">
              <button
                onClick={() => setDashboardTab('files')}
                className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  dashboardTab === 'files' 
                    ? 'bg-[#0ea5e9] text-white shadow' 
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                📁 Files & Folders
              </button>
              <button
                onClick={() => setDashboardTab('stars')}
                className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  dashboardTab === 'stars' 
                    ? 'bg-[#fbbf24] text-[#0a0f1a] shadow' 
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                ⭐ Star Analytics
              </button>
            </div>
            
            {/* Files Tab - Overview Stats Grid */}
            {dashboardTab === 'files' && (
              <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-gradient-to-br from-[#0ea5e9]/20 to-[#0ea5e9]/5 border border-[#0ea5e9]/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[#0ea5e9]">{dashboardStats.totalFiles}</div>
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Files</div>
              </div>
              <div className="bg-gradient-to-br from-[#8b5cf6]/20 to-[#8b5cf6]/5 border border-[#8b5cf6]/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[#8b5cf6]">{dashboardStats.totalFolders}</div>
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Folders</div>
              </div>
              <div className="bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 border border-[#22c55e]/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[#22c55e]">{dashboardStats.maxDepth}</div>
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Max Depth</div>
              </div>
              <div className="bg-gradient-to-br from-[#f59e0b]/20 to-[#f59e0b]/5 border border-[#f59e0b]/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[#f59e0b]">
                  {isLoadingContributions ? (
                    <div className="w-5 h-5 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin mx-auto" />
                  ) : (
                    contributionStats?.totalCommits || dashboardStats.totalCommits
                  )}
                </div>
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Commits</div>
              </div>
            </div>

            {/* Contributions Breakdown */}
            {(contributionStats || isLoadingContributions) && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Activity size={14} className="text-[#22c55e]" />
                  Total Contributions
                </h3>
                {isLoadingContributions ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-6 h-6 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
                    <span className="ml-2 text-[#64748b] text-sm">Loading contributions...</span>
                  </div>
                ) : contributionStats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-[#1e3a5f]/30 border border-[#1e3a5f] rounded-lg p-2 sm:p-3 flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-[#f59e0b]/20 rounded-lg shrink-0">
                        <History size={14} className="text-[#f59e0b]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base sm:text-lg font-bold text-white">{contributionStats.totalCommits.toLocaleString()}</div>
                        <div className="text-[9px] sm:text-[10px] text-[#64748b] truncate">Commits</div>
                      </div>
                    </div>
                    <div className="bg-[#1e3a5f]/30 border border-[#1e3a5f] rounded-lg p-2 sm:p-3 flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-[#8b5cf6]/20 rounded-lg shrink-0">
                        <GitPullRequest size={14} className="text-[#8b5cf6]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base sm:text-lg font-bold text-white">{contributionStats.totalPullRequests.toLocaleString()}</div>
                        <div className="text-[9px] sm:text-[10px] text-[#64748b] truncate">Pull Requests</div>
                      </div>
                    </div>
                    <div className="bg-[#1e3a5f]/30 border border-[#1e3a5f] rounded-lg p-2 sm:p-3 flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-[#22c55e]/20 rounded-lg shrink-0">
                        <AlertCircle size={14} className="text-[#22c55e]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base sm:text-lg font-bold text-white">{contributionStats.totalIssues.toLocaleString()}</div>
                        <div className="text-[9px] sm:text-[10px] text-[#64748b] truncate">Issues</div>
                      </div>
                    </div>
                    <div className="bg-[#1e3a5f]/30 border border-[#1e3a5f] rounded-lg p-2 sm:p-3 flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-[#0ea5e9]/20 rounded-lg shrink-0">
                        <MessageSquare size={14} className="text-[#0ea5e9]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base sm:text-lg font-bold text-white">~{contributionStats.totalReviews.toLocaleString()}</div>
                        <div className="text-[9px] sm:text-[10px] text-[#64748b] truncate">Reviews (est)</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Activity Patterns */}
            {contributionStats?.activityPatterns && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-[#fbbf24]" />
                  Activity Patterns
                </h3>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {/* Busiest Day */}
                  <div className="bg-gradient-to-br from-[#ec4899]/20 to-[#ec4899]/5 border border-[#ec4899]/30 rounded-lg p-2 sm:p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Calendar size={12} className="text-[#ec4899] shrink-0" />
                      <span className="text-[8px] sm:text-[10px] text-[#64748b] uppercase tracking-wide truncate">Busiest Day</span>
                    </div>
                    <div className="text-sm sm:text-lg font-bold text-[#ec4899] truncate">{contributionStats.activityPatterns.busiestDay.day}</div>
                    <div className="text-[9px] sm:text-[11px] text-[#94a3b8]">{contributionStats.activityPatterns.busiestDay.count}c</div>
                  </div>
                  
                  {/* Peak Hours */}
                  <div className="bg-gradient-to-br from-[#fbbf24]/20 to-[#fbbf24]/5 border border-[#fbbf24]/30 rounded-lg p-2 sm:p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Clock size={12} className="text-[#fbbf24] shrink-0" />
                      <span className="text-[8px] sm:text-[10px] text-[#64748b] uppercase tracking-wide truncate">Peak Hours</span>
                    </div>
                    <div className="text-sm sm:text-lg font-bold text-[#fbbf24] truncate">
                      {contributionStats.activityPatterns.peakHours.slice(0, 1).map(h => 
                        `${h.hour.toString().padStart(2, '0')}:00`
                      ).join('')}
                    </div>
                    <div className="text-[9px] sm:text-[11px] text-[#94a3b8]">
                      {contributionStats.activityPatterns.peakHours[0]?.count || 0}c
                    </div>
                  </div>
                  
                  {/* Peak Month */}
                  <div className="bg-gradient-to-br from-[#22d3ee]/20 to-[#22d3ee]/5 border border-[#22d3ee]/30 rounded-lg p-2 sm:p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Activity size={12} className="text-[#22d3ee] shrink-0" />
                      <span className="text-[8px] sm:text-[10px] text-[#64748b] uppercase tracking-wide truncate">Peak Month</span>
                    </div>
                    <div className="text-sm sm:text-lg font-bold text-[#22d3ee] truncate">{contributionStats.activityPatterns.peakMonth.month}</div>
                    <div className="text-[9px] sm:text-[11px] text-[#94a3b8]">{contributionStats.activityPatterns.peakMonth.count}c</div>
                  </div>
                </div>

                {/* Charts in a grid on larger screens */}
                <div className="grid sm:grid-cols-2 gap-3">
                  {/* Weekday Distribution Chart */}
                  <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                    <div className="text-[9px] sm:text-[10px] text-[#64748b] uppercase tracking-wide mb-2">Weekly Activity</div>
                    <div className="flex items-end gap-1" style={{ height: '60px' }}>
                      {contributionStats.activityPatterns.weekdayDistribution.map((day, i) => {
                        const maxCount = Math.max(...contributionStats.activityPatterns.weekdayDistribution.map(d => d.count), 1);
                        const heightPx = Math.max((day.count / maxCount) * 48, 4); // 48px max height, 4px min
                        const isMax = day.count === maxCount && day.count > 0;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center justify-end">
                            <div 
                              className={`w-full rounded-t transition-all ${isMax ? 'bg-[#ec4899]' : 'bg-[#3b82f6]'}`}
                              style={{ height: `${heightPx}px` }}
                              title={`${day.day}: ${day.count} commits`}
                            />
                            <span className="text-[8px] text-[#64748b] mt-1">{day.day.slice(0, 2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hourly Distribution Chart */}
                  <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                    <div className="text-[9px] sm:text-[10px] text-[#64748b] uppercase tracking-wide mb-2">Hourly (24h)</div>
                    <div className="flex items-end gap-px" style={{ height: '48px' }}>
                      {contributionStats.activityPatterns.hourlyDistribution.map((hour, i) => {
                        const maxCount = Math.max(...contributionStats.activityPatterns.hourlyDistribution.map(h => h.count), 1);
                        const heightPx = Math.max((hour.count / maxCount) * 40, 2); // 40px max, 2px min
                        const isPeak = contributionStats.activityPatterns.peakHours.some(p => p.hour === hour.hour);
                        return (
                          <div 
                            key={i}
                            className={`flex-1 rounded-t transition-all ${isPeak ? 'bg-[#fbbf24]' : hour.count > 0 ? 'bg-[#3b82f6]' : 'bg-[#1e3a5f]'}`}
                            style={{ height: `${heightPx}px` }}
                            title={`${hour.hour}:00 - ${hour.count} commits`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-1 text-[8px] text-[#475569]">
                      <span>0</span>
                      <span>12</span>
                      <span>23</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-6">
              {/* Language Breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#00d4ff]" />
                  File Types
                </h3>
                <div className="space-y-2">
                  {dashboardStats.topLanguages.map(([ext, count]) => {
                    const percentage = ((count / dashboardStats.totalFiles) * 100).toFixed(1);
                    const color = PACK_FILE_COLORS[ext] || '#64748b';
                    return (
                      <div key={ext} className="flex items-center gap-2">
                        <div className="w-12 text-[11px] font-mono text-[#94a3b8]">.{ext}</div>
                        <div className="flex-1 h-2 bg-[#1e3a5f]/50 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%`, backgroundColor: color }}
                          />
                        </div>
                        <div className="w-12 text-right text-[11px] text-[#64748b]">{count}</div>
                      </div>
              );
            })}
                </div>
              </div>

              {/* Top Folders */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                  Largest Folders
                </h3>
                <div className="space-y-2">
                  {dashboardStats.topFolders.map((folder) => (
                    <div 
                      key={folder.id} 
                      className="flex items-center gap-2 px-2 py-1.5 bg-[#1e3a5f]/20 rounded hover:bg-[#1e3a5f]/40 cursor-pointer transition-colors"
                      onClick={() => {
                        const node = data.nodes.find(n => n.id === folder.id);
                        if (node) {
                          onNodeSelect(node);
                          setSelectedNode(node);
                        }
                        setShowDashboard(false);
                      }}
                    >
                      <span className="text-[#8b5cf6]">📁</span>
                      <span className="flex-1 text-[11px] text-[#94a3b8] truncate font-mono">{folder.name}</span>
                      <span className="text-[10px] text-[#64748b] bg-[#1e3a5f] px-1.5 py-0.5 rounded">{folder.childCount}</span>
      </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top Contributors from API (if loaded) */}
            {contributionStats?.topContributors && contributionStats.topContributors.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                  Top Contributors
                </h3>
                <div className="space-y-2">
                  {contributionStats.topContributors.map((contributor, i) => (
                    <div 
                      key={i}
                      className="flex items-center gap-3 px-3 py-2 bg-[#1e3a5f]/20 rounded-lg border border-[#1e3a5f]/50 hover:bg-[#1e3a5f]/40 transition-colors"
                    >
                      <div className="text-[#fbbf24] font-bold text-sm w-5">#{i + 1}</div>
                      {contributor.avatar ? (
                        <img 
                          src={contributor.avatar} 
                          alt={contributor.login}
                          className="w-8 h-8 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#1e3a5f] flex items-center justify-center text-[#64748b] text-xs shrink-0">
                          {contributor.login.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-white font-medium truncate">{contributor.login}</div>
                        <div className="flex items-center gap-2 text-[9px]">
                          {contributor.commits > 0 && (
                            <span className="text-[#f59e0b]" title="Commits">
                              {contributor.commits.toLocaleString()} commits
                            </span>
                          )}
                          {contributor.pullRequests > 0 && (
                            <span className="text-[#8b5cf6]" title="Pull Requests">
                              {contributor.pullRequests} PRs
                            </span>
                          )}
                          {contributor.issues > 0 && (
                            <span className="text-[#22c55e]" title="Issues">
                              {contributor.issues} issues
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Committers (Last 7 Days) */}
            {contributionStats?.recentCommitters && contributionStats.recentCommitters.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  Recent Activity (Last 7 Days)
                </h3>
                <div className="flex flex-wrap gap-2">
                  {contributionStats.recentCommitters.map((committer, i) => (
                    <div 
                      key={i}
                      className="flex items-center gap-2 px-3 py-2 bg-[#22c55e]/10 rounded-lg border border-[#22c55e]/30 hover:bg-[#22c55e]/20 transition-colors"
                    >
                      {committer.avatar ? (
                        <img 
                          src={committer.avatar} 
                          alt={committer.login}
                          className="w-6 h-6 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-[#22c55e]/20 flex items-center justify-center text-[#22c55e] text-[9px] shrink-0">
                          {committer.login.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] text-white font-medium">{committer.login}</div>
                        <div className="text-[9px] text-[#22c55e]">{committer.commits} commits</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fallback to local contributors if API not loaded */}
            {!contributionStats && dashboardStats.topContributors.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  Top Contributors
                </h3>
                <div className="flex flex-wrap gap-2">
                  {dashboardStats.topContributors.map((contributor, i) => (
                    <div 
                      key={i}
                      className="flex items-center gap-2 px-2 py-1.5 bg-[#1e3a5f]/30 rounded-full border border-[#1e3a5f]"
                    >
                      <img 
                        src={contributor.avatar} 
                        alt={contributor.name}
                        className="w-5 h-5 rounded-full"
                      />
                      <span className="text-[11px] text-[#94a3b8]">{contributor.name}</span>
                      <span className="text-[10px] text-[#22c55e] font-medium">{contributor.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Size Info */}
            {dashboardStats.totalSize > 0 && (
              <div className="mt-6 pt-4 border-t border-[#1e3a5f] flex items-center justify-between text-[11px] text-[#64748b]">
                <span>Total Size: <span className="text-[#94a3b8] font-medium">{(dashboardStats.totalSize / 1024).toFixed(1)} KB</span></span>
                <span>Avg Depth: <span className="text-[#94a3b8] font-medium">{dashboardStats.avgDepth} levels</span></span>
              </div>
            )}
              </>
            )}

            {/* Stars Tab - Star Analytics */}
            {dashboardTab === 'stars' && (
              <div>
                {isLoadingAnalytics ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#fbbf24] border-t-transparent rounded-full animate-spin mb-3" />
                    <span className="text-[#64748b] text-sm">Loading complete star history...</span>
                    <span className="text-[#475569] text-[10px] mt-1">This may take a moment for large repos</span>
                  </div>
                ) : starAnalytics ? (
                  <>
                    {/* Repo Age & Data Info */}
                    <div className="flex items-center justify-between mb-4 text-[10px] text-[#64748b]">
                      <span>📅 Created {starAnalytics.createdAt} ({starAnalytics.ageInDays} days ago)</span>
                      <span className={`px-2 py-0.5 rounded ${starAnalytics.dataCompleteness >= 90 ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#fbbf24]/20 text-[#fbbf24]'}`}>
                        {starAnalytics.dataCompleteness.toFixed(0)}% data coverage
                      </span>
                    </div>

                    {/* Star Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                      <div className="bg-gradient-to-br from-[#fbbf24]/20 to-[#fbbf24]/5 border border-[#fbbf24]/30 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-[#fbbf24]">{starAnalytics.totalStars.toLocaleString()}</div>
                        <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Total Stars</div>
                      </div>
                      <div className="bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 border border-[#22c55e]/30 rounded-lg p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-2xl font-bold text-[#22c55e]">{starAnalytics.trends.avg7d}</span>
                          {starAnalytics.trends.trend === 'up' && <TrendingUp size={14} className="text-[#22c55e]" />}
                          {starAnalytics.trends.trend === 'down' && <TrendingDown size={14} className="text-[#ef4444]" />}
                          {starAnalytics.trends.trend === 'stable' && <Minus size={14} className="text-[#64748b]" />}
                        </div>
                        <div className="text-[10px] text-[#64748b] uppercase tracking-wide">7d Avg/Day</div>
                      </div>
                      <div className="bg-gradient-to-br from-[#0ea5e9]/20 to-[#0ea5e9]/5 border border-[#0ea5e9]/30 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-[#0ea5e9]">{starAnalytics.trends.avg30d}</div>
                        <div className="text-[10px] text-[#64748b] uppercase tracking-wide">30d Avg/Day</div>
                      </div>
                      <div className="bg-gradient-to-br from-[#8b5cf6]/20 to-[#8b5cf6]/5 border border-[#8b5cf6]/30 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-[#8b5cf6]">{starAnalytics.avgStarsPerDay.toFixed(1)}</div>
                        <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Lifetime Avg</div>
                      </div>
                      <div className="bg-gradient-to-br from-[#ec4899]/20 to-[#ec4899]/5 border border-[#ec4899]/30 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-[#ec4899]">{starAnalytics.trends.peakDay.stars}</div>
                        <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Peak Day</div>
                      </div>
                    </div>

                    {/* Complete Star History (Cumulative) */}
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#0ea5e9]" />
                        Complete Star History (Since {starAnalytics.createdAt})
                      </h3>
                      <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                        <div className="flex items-end gap-px h-28">
                          {(() => {
                            // Sample the history to ~60 data points for display
                            const history = starAnalytics.dailyHistory;
                            const step = Math.max(1, Math.floor(history.length / 60));
                            const sampled = history.filter((_, i) => i % step === 0 || i === history.length - 1);
                            const maxCumulative = Math.max(...sampled.map(d => d.cumulative), 1);
                            
                            return sampled.map((day, i) => {
                              const height = (day.cumulative / maxCumulative) * 100;
                              return (
                                <div 
                                  key={i} 
                                  className="flex-1 bg-gradient-to-t from-[#0ea5e9] to-[#22d3ee] rounded-t hover:from-[#0284c7] hover:to-[#06b6d4] transition-colors cursor-pointer group relative"
                                  style={{ height: `${Math.max(height, 2)}%` }}
                                >
                                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#0a0f1a] border border-[#1e3a5f] rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                    <div className="font-medium">{day.cumulative.toLocaleString()} ⭐</div>
                                    <div className="text-[#64748b]">{day.date}</div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                        <div className="flex justify-between mt-2 text-[9px] text-[#64748b]">
                          <span>{starAnalytics.createdAt}</span>
                          <span className="text-[#0ea5e9]">{starAnalytics.dailyHistory.length} days of history</span>
                          <span>Today</span>
                        </div>
                      </div>
                    </div>

                    {/* Daily Stars (Last 30 Days) */}
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                        Daily Stars (Last 30 Days)
                      </h3>
                      <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                        <div className="flex items-end gap-0.5 h-20">
                          {starAnalytics.recentActivity.map((day, i) => {
                            const maxStars = Math.max(...starAnalytics.recentActivity.map(d => d.daily), 1);
                            const height = (day.daily / maxStars) * 100;
                            const isPeak = day.date === starAnalytics.trends.peakDay.date;
                            return (
                              <div 
                                key={i} 
                                className={`flex-1 rounded-t transition-colors cursor-pointer group relative ${isPeak ? 'bg-[#ec4899]' : 'bg-[#fbbf24] hover:bg-[#f59e0b]'}`}
                                style={{ height: `${Math.max(height, 2)}%` }}
                              >
                                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#0a0f1a] border border-[#1e3a5f] rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                  <div className="font-medium">{day.daily} ⭐ {isPeak && '🏆'}</div>
                                  <div className="text-[#64748b]">{day.date}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-between mt-2 text-[9px] text-[#64748b]">
                          <span>30 days ago</span>
                          <span>Today</span>
                        </div>
                      </div>
                    </div>

                    {/* Hourly Activity (Last 7 Days) */}
                    {starAnalytics.hourlyActivity && starAnalytics.hourlyActivity.length > 0 && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#a855f7]" />
                          Hourly Activity (Last 7 Days)
                        </h3>
                        <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                          <div className="flex items-end gap-px h-16">
                            {(() => {
                              // Sample hourly data to ~84 points (12 per day)
                              const hourly = starAnalytics.hourlyActivity;
                              const step = Math.max(1, Math.floor(hourly.length / 84));
                              const sampled = hourly.filter((_, i) => i % step === 0);
                              const maxHourly = Math.max(...sampled.map(h => h.stars), 1);
                              
                              return sampled.map((hour, i) => {
                                const height = (hour.stars / maxHourly) * 100;
                                return (
                                  <div 
                                    key={i} 
                                    className="flex-1 bg-[#a855f7] rounded-t hover:bg-[#9333ea] transition-colors cursor-pointer group relative"
                                    style={{ height: `${Math.max(height, hour.stars > 0 ? 8 : 2)}%` }}
                                  >
                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#0a0f1a] border border-[#1e3a5f] rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                      <div className="font-medium">{hour.stars} ⭐</div>
                                      <div className="text-[#64748b]">{new Date(hour.hour).toLocaleString()}</div>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                          <div className="flex justify-between mt-2 text-[9px] text-[#64748b]">
                            <span>7 days ago</span>
                            <span className="text-[#a855f7]">Hourly breakdown</span>
                            <span>Now</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Growth & Peak Info */}
                    <div className="grid sm:grid-cols-3 gap-4 mb-4">
                      <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                        <h4 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">30d Growth</h4>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-xl font-bold ${starAnalytics.trends.growthRate >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                            {starAnalytics.trends.growthRate >= 0 ? '+' : ''}{starAnalytics.trends.growthRate.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                        <h4 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">Peak Day</h4>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold text-[#ec4899]">{starAnalytics.trends.peakDay.stars} ⭐</span>
                          <span className="text-[11px] text-[#64748b]">{starAnalytics.trends.peakDay.date}</span>
                        </div>
                      </div>
                      <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
                        <h4 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-2">Trend</h4>
                        <div className="flex items-center gap-2">
                          {starAnalytics.trends.trend === 'up' && <TrendingUp size={20} className="text-[#22c55e]" />}
                          {starAnalytics.trends.trend === 'down' && <TrendingDown size={20} className="text-[#ef4444]" />}
                          {starAnalytics.trends.trend === 'stable' && <Minus size={20} className="text-[#64748b]" />}
                          <span className={`text-lg font-bold capitalize ${
                            starAnalytics.trends.trend === 'up' ? 'text-[#22c55e]' : 
                            starAnalytics.trends.trend === 'down' ? 'text-[#ef4444]' : 'text-[#64748b]'
                          }`}>
                            {starAnalytics.trends.trend === 'up' ? 'Rising' : starAnalytics.trends.trend === 'down' ? 'Declining' : 'Stable'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Export Options */}
                    {repoInfo && (
                      <div className="pt-4 border-t border-[#1e3a5f]">
                        <h4 className="text-xs font-medium text-[#64748b] uppercase tracking-wide mb-3">Export Data</h4>
                        <div className="flex gap-2 flex-wrap">
                          <a
                            href={`/api/github/export-stars/${repoInfo.fullName}?format=csv${token ? `&token=${token}` : ''}`}
                            download
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f]/50 rounded-lg text-[11px] text-[#94a3b8] hover:bg-[#1e3a5f] hover:text-white transition-colors"
                          >
                            <Download size={12} />
                            CSV (Full History)
                          </a>
                          <a
                            href={`/api/github/export-stars/${repoInfo.fullName}?format=json${token ? `&token=${token}` : ''}`}
                            download
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f]/50 rounded-lg text-[11px] text-[#94a3b8] hover:bg-[#1e3a5f] hover:text-white transition-colors"
                          >
                            <Download size={12} />
                            JSON (Full History)
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <span className="text-4xl mb-3">⭐</span>
                    <span className="text-[#64748b] text-sm mb-2">Star analytics requires a GitHub token</span>
                    <span className="text-[#475569] text-xs">Add a token to see complete daily star history and trends</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-[#1e3a5f] text-center">
              <span className="text-xs text-[#64748b]">Press <kbd className="px-1.5 py-0.5 bg-[#1e3a5f] rounded text-white font-mono text-[10px]">d</kbd> to toggle dashboard</span>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard hint - shifts left when sidebar open */}
      <div className={`absolute bottom-2 text-[10px] text-[#475569] font-mono hidden sm:block transition-all ${selectedNode ? 'right-80' : 'right-4'}`}>
        Press <kbd className="px-1 py-0.5 bg-[#1e3a5f] rounded text-[#64748b] font-mono">?</kbd> for shortcuts
      </div>

    </div>
  );
};

export default Visualizer;
