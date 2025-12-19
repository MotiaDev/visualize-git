import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { RepoData, RepoNode, RepoLink } from '../types';
import { ZoomIn, ZoomOut, Maximize2, Circle, GitBranch, History, X, Layers } from 'lucide-react';
import TimelinePlayer, { CommitData } from './TimelinePlayer';

interface VisualizerProps {
  data: RepoData;
  onNodeSelect: (node: RepoNode) => void;
  highlightedNodes?: Set<string>;
  focusNode?: RepoNode | null;
  commits?: CommitData[];
  isLoadingCommits?: boolean;
  onLoadCommits?: () => void;
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
      
      {/* View Options - Compact toggle in top-left, smaller on mobile */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-50 flex items-center gap-1 sm:gap-2" style={{ pointerEvents: 'auto' }}>
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
          <button
            onClick={() => setShowLayoutToggle(true)}
            className="p-2.5 bg-[#0d1424] border border-[#1e3a5f] rounded-lg text-[#64748b] hover:text-[#00d4ff] hover:bg-[#1e3a5f] hover:border-[#00d4ff] transition-colors shadow-lg cursor-pointer"
            title="View options (layouts, timeline)"
            style={{ pointerEvents: 'auto' }}
          >
            <Layers size={16} />
          </button>
        )}
      </div>

      {/* Hovered Node Info - positioned below header with high z-index */}
      {/* Hovered node tooltip - positioned lower on mobile */}
      {hoveredNode && (
        <div className="absolute top-24 sm:top-44 left-1/2 -translate-x-1/2 bg-[#0d1424]/95 border border-[#1e3a5f] rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 pointer-events-none z-30 shadow-lg max-w-[90vw]">
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

      
      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
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

      {/* Legend - Shows colors based on layout mode (shift left when panel open) */}
      <div className={`absolute top-4 bg-[#0d1424]/90 border border-[#1e3a5f] rounded px-3 py-2 hidden sm:block transition-all ${selectedNode ? 'right-84' : 'right-4'}`}>
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

      {/* Tip for large repos - hidden on mobile to avoid overlap */}
      {isLargeGraph && !collapsibleMode && layoutMode === 'force' && (
        <div className="absolute top-52 left-4 z-30 max-w-xs hidden sm:block">
          <div className="bg-[#0d1424]/95 border border-[#f59e0b]/50 rounded-lg px-3 py-2 text-[11px]">
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

      {/* Tip when in collapsible mode - hidden on mobile */}
      {collapsibleMode && expandedNodes.size <= 1 && (
        <div className="absolute top-16 left-4 z-40 max-w-sm hidden sm:block">
          <div className="bg-[#0d1424]/95 border border-[#8b5cf6]/50 rounded-lg px-4 py-3 text-xs">
            <div className="flex items-start gap-2">
              <span className="text-xl">🌳</span>
              <div>
                <span className="text-[#8b5cf6] font-semibold">Tree Mode</span>
                <p className="text-[#94a3b8] mt-1 leading-relaxed">
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

      {/* Timeline Panel (Gource-style git history) */}
      {showTimeline && (
        <div className="absolute bottom-20 sm:bottom-16 left-4 right-4 sm:right-auto sm:w-96 z-30">
          <div className="relative">
            <button
              onClick={() => setShowTimeline(false)}
              className="absolute -top-2 -right-2 p-1 bg-[#1e3a5f] hover:bg-[#2d4a6f] rounded-full text-[#64748b] hover:text-white z-10"
            >
              <X size={14} />
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
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={() => setShowDashboard(false)}
        >
          <div 
            className="bg-[#0a0f1a] border border-[#1e3a5f] rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">📊 Repository Dashboard</h2>
              <button 
                onClick={() => setShowDashboard(false)}
                className="p-1 text-[#64748b] hover:text-white hover:bg-[#1e3a5f] rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            {/* Overview Stats Grid */}
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
                <div className="text-2xl font-bold text-[#f59e0b]">{dashboardStats.totalCommits}</div>
                <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Commits</div>
              </div>
            </div>

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

            {/* Contributors (if commits loaded) */}
            {dashboardStats.topContributors.length > 0 && (
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

            <div className="mt-5 pt-4 border-t border-[#1e3a5f] text-center">
              <span className="text-xs text-[#64748b]">Press <kbd className="px-1.5 py-0.5 bg-[#1e3a5f] rounded text-white font-mono text-[10px]">d</kbd> to toggle dashboard</span>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="absolute bottom-4 right-4 text-[10px] text-[#475569] font-mono hidden sm:block">
        Press <kbd className="px-1 py-0.5 bg-[#1e3a5f] rounded text-[#64748b] font-mono">?</kbd> for shortcuts
      </div>

      {/* Dashboard button */}
      <button
        onClick={() => setShowDashboard(true)}
        className="absolute bottom-4 left-4 px-3 py-1.5 bg-[#0d1424]/90 border border-[#1e3a5f] rounded-lg text-[11px] text-[#94a3b8] hover:border-[#00d4ff] hover:text-[#00d4ff] transition-all hidden sm:flex items-center gap-1.5"
      >
        <span>📊</span>
        <span>Dashboard</span>
        <kbd className="px-1 py-0.5 bg-[#1e3a5f] rounded text-[#64748b] font-mono text-[9px] ml-1">d</kbd>
      </button>
    </div>
  );
};

export default Visualizer;
