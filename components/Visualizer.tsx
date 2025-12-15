import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { RepoData, RepoNode, RepoLink } from '../types';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface VisualizerProps {
  data: RepoData;
  onNodeSelect: (node: RepoNode) => void;
  highlightedNodes?: Set<string>;
  focusNode?: RepoNode | null;
}

// Get node color based on extension
const getNodeColor = (node: RepoNode): string => {
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

const Visualizer: React.FC<VisualizerProps> = ({ 
  data, 
  onNodeSelect, 
  highlightedNodes = new Set(),
  focusNode 
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

  // Generate random stars for background
  const stars = useMemo(() => {
    return Array.from({ length: 300 }).map((_, i) => ({
      id: i,
      x: Math.random() * dimensions.width,
      y: Math.random() * dimensions.height,
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

    svg.call(zoom.transform, d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(0.75));

    return () => {
      svg.on('.zoom', null);
    };
  }, [dimensions]);

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

  useEffect(() => {
    if (!data.nodes.length || !gRef.current) return;

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const g = d3.select(gRef.current);
    g.selectAll('*').remove();

    const simNodes: RepoNode[] = data.nodes.map(d => ({ ...d, x: 0, y: 0 }));
    const simLinks: RepoLink[] = data.links.map(d => ({ ...d }));

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<RepoNode, RepoLink>(simLinks)
        .id(d => d.id)
        .distance(35)
        .strength(0.5))
      .force('charge', d3.forceManyBody()
        .strength(-90)  // More repulsion for spacing
        .distanceMax(180))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(d => getNodeSize(d as RepoNode) + 5))  // More collision padding
      .force('x', d3.forceX(0).strength(0.03))
      .force('y', d3.forceY(0).strength(0.03));

    simulationRef.current = simulation;

    // Links
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup.selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('class', 'link-line')
      .attr('stroke', '#1e3a5f')
      .attr('stroke-width', 0.8)
      .attr('stroke-opacity', 0.5);

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

    // Circles
    node.each(function(d) {
      const color = getNodeColor(d);
      const size = getNodeSize(d);
      const g = d3.select(this);
      
      if (d.id === 'ROOT') {
        g.append('circle')
          .attr('class', 'glow')
          .attr('r', size + 6)
          .attr('fill', color)
          .attr('opacity', 0.15);
      }
      
      g.append('circle')
        .attr('class', 'node-circle')
        .attr('r', size)
        .attr('fill', color)
        .attr('stroke', d.id === 'ROOT' ? '#00d4ff' : 'transparent')
        .attr('stroke-width', d.id === 'ROOT' ? 2 : 0);
    });

    // Labels for directories
    node.filter(d => d.id === 'ROOT' || d.type === 'tree')
      .append('text')
      .attr('class', 'node-label')
      .text(d => d.name)
      .attr('x', 0)
      .attr('y', d => -(getNodeSize(d) + 6))
      .attr('text-anchor', 'middle')
      .attr('font-size', d => d.id === 'ROOT' ? '11px' : '8px')
      .attr('font-weight', d => d.id === 'ROOT' ? '600' : '400')
      .attr('fill', '#94a3b8')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('pointer-events', 'none');

    // Hover interactions with path highlighting
    node
      .on('mouseenter', function(event, d) {
        const size = getNodeSize(d);
        const pathNodes = getPathToRoot(d.id, simNodes);
        setHoveredPath(pathNodes);
        
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
        const size = getNodeSize(d);
        setHoveredPath(new Set());
        
        d3.select(this).select('.node-circle')
          .transition()
          .duration(150)
          .attr('r', size);
        d3.select(this).select('.hover-label').remove();
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeSelect(d);
      });

    simulation.on('tick', () => {
      // Update node positions map
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
  }, [data, onNodeSelect, getPathToRoot]);

  // Update highlighting based on search/hover
  useEffect(() => {
    if (!gRef.current) return;
    const g = d3.select(gRef.current);
    
    const hasHighlight = highlightedNodes.size > 0;
    const hasHover = hoveredPath.size > 0;
    
    g.selectAll('.node-group').each(function(d: any) {
      if (!d || !d.id) return;
      
      const isHighlighted = highlightedNodes.has(d.id);
      const isInPath = hoveredPath.has(d.id);
      
      let opacity = 1;
      if (hasHighlight && !isHighlighted) opacity = 0.2;
      if (hasHover && !isInPath) opacity = 0.3;
      if (isInPath || isHighlighted) opacity = 1;
      
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
  }, [highlightedNodes, hoveredPath]);

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
    d3.select(svgRef.current).transition().duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(0.75));
  }, [dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#050810]">
      <svg 
        ref={svgRef} 
        className="w-full h-full"
        width={dimensions.width}
        height={dimensions.height}
      >
        <defs>
          <radialGradient id="space-bg" cx="50%" cy="50%" r="80%">
            <stop offset="0%" stopColor="#0d1424" />
            <stop offset="60%" stopColor="#0a0f1a" />
            <stop offset="100%" stopColor="#050810" />
          </radialGradient>
        </defs>
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

      {/* Legend - hidden on mobile to avoid overlap */}
      <div className="absolute top-4 right-4 bg-[#0d1424]/90 border border-[#1e3a5f] rounded px-3 py-2 hidden sm:block">
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
      </div>

      {/* Stats - Desktop */}
      <div className="absolute bottom-4 left-4 text-[10px] text-[#475569] font-mono hidden sm:block">
        {data.nodes.length} nodes · {data.links.length} edges · {Math.round(transform.k * 100)}%
      </div>

      {/* Mobile Legend - Compact horizontal bar */}
      <div className="absolute bottom-20 left-2 right-2 sm:hidden">
        <div className="flex items-center justify-center gap-3 bg-[#0d1424]/90 border border-[#1e3a5f] rounded-full px-3 py-1.5">
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
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#475569]" />
            <span className="text-[8px] text-[#64748b]">Other</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Visualizer;
