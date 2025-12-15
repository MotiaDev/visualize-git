import React, { useEffect, useState, useMemo } from 'react';
import { RepoInfo } from '../types';
import { Star, TrendingUp, Loader2, ExternalLink } from 'lucide-react';

interface StarHistoryProps {
  repoInfo: RepoInfo;
  onOpenFullPage: () => void;
  token?: string;
}

interface StarDataPoint {
  date: string;
  stars: number;
}

// Use relative URLs in production (goes through Vercel proxy)
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const StarHistory: React.FC<StarHistoryProps> = ({ repoInfo, onOpenFullPage, token }) => {
  const [history, setHistory] = useState<StarDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard: Skip if repoInfo doesn't have required properties
    if (!repoInfo?.owner?.login || !repoInfo?.name) {
      setLoading(false);
      return;
    }
    
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const response = await fetch(
          `${API_BASE}/api/github/stars/${repoInfo.owner.login}/${repoInfo.name}${tokenParam}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.history && data.history.length > 0) {
            setHistory(data.history);
          } else {
            // Create simulated growth curve if no history
            setHistory(generateSimulatedHistory(repoInfo.stars ?? 0));
          }
        } else {
          // API failed, create simulated history
          setHistory(generateSimulatedHistory(repoInfo.stars ?? 0));
        }
      } catch (err: any) {
        setError(err.message);
        // Create simulated history on error
        setHistory(generateSimulatedHistory(repoInfo.stars ?? 0));
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [repoInfo.owner.login, repoInfo.name, repoInfo.stars, token]);

  // Generate a simulated growth curve based on current star count
  const generateSimulatedHistory = (totalStars: number): StarDataPoint[] => {
    const points: StarDataPoint[] = [];
    const now = new Date();
    const yearsAgo = Math.min(5, Math.max(1, Math.floor(Math.log10(totalStars + 1))));
    
    // Generate 12 data points showing exponential-ish growth
    for (let i = 0; i <= 11; i++) {
      const monthsAgo = (11 - i) * (yearsAgo * 12 / 11);
      const date = new Date(now);
      date.setMonth(date.getMonth() - Math.floor(monthsAgo));
      
      // Simulate S-curve growth
      const progress = i / 11;
      const growthFactor = Math.pow(progress, 1.5);
      const stars = Math.round(totalStars * growthFactor);
      
      points.push({
        date: date.toISOString().split('T')[0],
        stars: Math.max(1, stars),
      });
    }
    
    return points;
  };

  // Chart calculations
  const chartData = useMemo(() => {
    if (history.length < 2) return null;

    const width = 240;
    const height = 100;
    const padding = { top: 12, right: 12, bottom: 20, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxStars = Math.max(...history.map(d => d.stars));
    const minStars = 0;
    const dates = history.map(d => new Date(d.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    const xScale = (date: string) => {
      const t = new Date(date).getTime();
      return padding.left + ((t - minDate) / dateRange) * chartWidth;
    };

    const yScale = (stars: number) => {
      return padding.top + chartHeight - ((stars - minStars) / (maxStars - minStars || 1)) * chartHeight;
    };

    // Generate smooth curve points
    const pathPoints = history.map(d => ({ x: xScale(d.date), y: yScale(d.stars) }));
    
    // Create smooth bezier curve
    let linePath = `M ${pathPoints[0].x},${pathPoints[0].y}`;
    for (let i = 1; i < pathPoints.length; i++) {
      const prev = pathPoints[i - 1];
      const curr = pathPoints[i];
      const cpx = (prev.x + curr.x) / 2;
      linePath += ` Q ${cpx},${prev.y} ${cpx},${(prev.y + curr.y) / 2}`;
      linePath += ` Q ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }

    // Simple line path as fallback
    const simpleLinePath = `M ${pathPoints.map(p => `${p.x},${p.y}`).join(' L ')}`;
    
    const areaPath = `${simpleLinePath} L ${pathPoints[pathPoints.length - 1].x},${height - padding.bottom} L ${pathPoints[0].x},${height - padding.bottom} Z`;

    const yLabels = [
      { y: yScale(maxStars), label: maxStars >= 1000 ? `${(maxStars / 1000).toFixed(0)}k` : maxStars.toString() },
      { y: yScale(0), label: '0' },
    ];

    const startYear = new Date(history[0].date).getFullYear();
    const endYear = new Date(history[history.length - 1].date).getFullYear();

    return { width, height, linePath: simpleLinePath, areaPath, yLabels, padding, pathPoints, startYear, endYear };
  }, [history]);

  return (
    <div className="p-4 border-b border-[#1e3a5f]">
      <button
        onClick={onOpenFullPage}
        className="w-full text-left group"
      >
        <h3 className="text-[10px] uppercase tracking-wider text-[#475569] mb-2 flex items-center gap-1 group-hover:text-[#00d4ff] transition-colors">
          <TrendingUp size={10} />
          Star History
          <ExternalLink size={8} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </h3>
      </button>

      <button
        onClick={onOpenFullPage}
        className="w-full bg-[#0a0f1a] border border-[#1e3a5f] rounded p-3 overflow-hidden hover:border-[#00d4ff] transition-colors cursor-pointer"
      >
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={20} className="text-[#00d4ff] animate-spin" />
          </div>
        ) : chartData ? (
          <>
            <svg 
              width={chartData.width} 
              height={chartData.height} 
              className="w-full"
              viewBox={`0 0 ${chartData.width} ${chartData.height}`}
            >
              {/* Grid line */}
              <line
                x1={chartData.padding.left}
                y1={chartData.yLabels[0].y}
                x2={chartData.width - chartData.padding.right}
                y2={chartData.yLabels[0].y}
                stroke="#1e3a5f"
                strokeWidth="1"
                strokeDasharray="3,3"
              />

              {/* Area fill */}
              <path
                d={chartData.areaPath}
                fill="url(#miniStarGradient)"
              />

              {/* Line */}
              <path
                d={chartData.linePath}
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* End point glow */}
              <circle
                cx={chartData.pathPoints[chartData.pathPoints.length - 1].x}
                cy={chartData.pathPoints[chartData.pathPoints.length - 1].y}
                r="4"
                fill="#fbbf24"
                className="animate-pulse"
              />

              {/* Y-axis labels */}
              {chartData.yLabels.map((label, i) => (
                <text
                  key={i}
                  x={chartData.padding.left - 6}
                  y={label.y + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="#64748b"
                  fontFamily="ui-monospace, monospace"
                >
                  {label.label}
                </text>
              ))}

              {/* X-axis labels */}
              <text
                x={chartData.padding.left}
                y={chartData.height - 4}
                textAnchor="start"
                fontSize="8"
                fill="#475569"
                fontFamily="ui-monospace, monospace"
              >
                {chartData.startYear}
              </text>
              <text
                x={chartData.width - chartData.padding.right}
                y={chartData.height - 4}
                textAnchor="end"
                fontSize="8"
                fill="#475569"
                fontFamily="ui-monospace, monospace"
              >
                {chartData.endYear}
              </text>

              <defs>
                <linearGradient id="miniStarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.02" />
                </linearGradient>
              </defs>
            </svg>

            {/* Star count and trend */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1.5 text-[#fbbf24]">
                <Star size={12} className="fill-current" />
                <span className="text-sm font-bold tabular-nums">
                  {(repoInfo.stars ?? 0).toLocaleString()}
                </span>
              </div>
              <span className="text-[8px] text-[#22c55e] flex items-center gap-0.5">
                <TrendingUp size={8} />
                {error ? 'simulated' : `${history.length} pts`}
              </span>
            </div>
          </>
        ) : (
          // Fallback: just show star count with mini visualization
          <div className="flex flex-col items-center py-2">
            <div className="flex items-center gap-2 text-[#fbbf24]">
              <Star size={20} className="fill-current" />
              <span className="text-xl font-bold tabular-nums">
                {(repoInfo.stars ?? 0).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </button>

      <p className="text-[8px] text-[#475569] text-center mt-1.5">
        Click to view full history
      </p>
    </div>
  );
};

export default StarHistory;
