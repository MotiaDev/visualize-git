import React, { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Calendar, Zap, BarChart3, Download, RefreshCw } from 'lucide-react';
import { fetchStarAnalytics, StarAnalytics as StarAnalyticsData, DailyStar } from '../services/githubService';

interface StarAnalyticsProps {
  owner: string;
  repo: string;
  token?: string;
  onClose?: () => void;
}

const StarAnalytics: React.FC<StarAnalyticsProps> = ({ owner, repo, token, onClose }) => {
  const [analytics, setAnalytics] = useState<StarAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<30 | 60 | 90>(30);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchStarAnalytics(owner, repo, token, timeRange);
        setAnalytics(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [owner, repo, token, timeRange]);

  // Calculate chart data
  const chartData = useMemo(() => {
    if (!analytics) return [];
    return analytics.recentActivity.slice(-timeRange);
  }, [analytics, timeRange]);

  const maxDailyStars = useMemo(() => {
    return Math.max(...chartData.map(d => d.daily), 1);
  }, [chartData]);

  // Export to CSV
  const exportCSV = () => {
    if (!analytics) return;
    
    const headers = ['Date', 'Daily Stars', 'Cumulative'];
    const rows = analytics.dailyHistory.map(d => 
      [d.date, d.daily, d.cumulative].join(',')
    );
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${owner}-${repo}-stars.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const TrendIcon = ({ trend }: { trend: 'up' | 'stable' | 'down' }) => {
    if (trend === 'up') return <TrendingUp className="text-[#22c55e]" size={16} />;
    if (trend === 'down') return <TrendingDown className="text-[#ef4444]" size={16} />;
    return <Minus className="text-[#64748b]" size={16} />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="animate-spin text-[#00d4ff]" size={24} />
        <span className="ml-2 text-[#94a3b8]">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg text-[#ef4444] text-sm">
        {error}
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <BarChart3 className="text-[#fbbf24]" size={20} />
          Star Analytics
        </h3>
        <div className="flex items-center gap-2">
          {/* Time range buttons */}
          <div className="flex bg-[#1e3a5f]/50 rounded-lg p-0.5">
            {[30, 60, 90].map((days) => (
              <button
                key={days}
                onClick={() => setTimeRange(days as 30 | 60 | 90)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  timeRange === days
                    ? 'bg-[#00d4ff] text-[#0a0f1a]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
          {/* Export button */}
          <button
            onClick={exportCSV}
            className="p-1.5 text-[#64748b] hover:text-[#00d4ff] hover:bg-[#1e3a5f] rounded transition-colors"
            title="Export CSV"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Stars */}
        <div className="bg-gradient-to-br from-[#fbbf24]/20 to-[#fbbf24]/5 border border-[#fbbf24]/30 rounded-lg p-3">
          <div className="text-2xl font-bold text-[#fbbf24]">
            {analytics.totalStars.toLocaleString()}
          </div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Total Stars</div>
        </div>

        {/* 7-Day Avg */}
        <div className="bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 border border-[#22c55e]/30 rounded-lg p-3">
          <div className="flex items-center gap-1">
            <span className="text-2xl font-bold text-[#22c55e]">{analytics.trends.avg7d}</span>
            <span className="text-[10px] text-[#64748b]">/day</span>
          </div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wide">7-Day Avg</div>
        </div>

        {/* Velocity */}
        <div className="bg-gradient-to-br from-[#8b5cf6]/20 to-[#8b5cf6]/5 border border-[#8b5cf6]/30 rounded-lg p-3">
          <div className="flex items-center gap-1">
            <Zap className="text-[#8b5cf6]" size={16} />
            <span className="text-2xl font-bold text-[#8b5cf6]">{analytics.trends.velocity}</span>
          </div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wide">Velocity</div>
        </div>

        {/* Trend */}
        <div className={`bg-gradient-to-br ${
          analytics.trends.trend === 'up' 
            ? 'from-[#22c55e]/20 to-[#22c55e]/5 border-[#22c55e]/30' 
            : analytics.trends.trend === 'down'
            ? 'from-[#ef4444]/20 to-[#ef4444]/5 border-[#ef4444]/30'
            : 'from-[#64748b]/20 to-[#64748b]/5 border-[#64748b]/30'
        } border rounded-lg p-3`}>
          <div className="flex items-center gap-1">
            <TrendIcon trend={analytics.trends.trend} />
            <span className={`text-lg font-bold capitalize ${
              analytics.trends.trend === 'up' ? 'text-[#22c55e]' : 
              analytics.trends.trend === 'down' ? 'text-[#ef4444]' : 'text-[#64748b]'
            }`}>
              {analytics.trends.trend === 'up' ? 'Rising' : analytics.trends.trend === 'down' ? 'Declining' : 'Stable'}
            </span>
          </div>
          <div className="text-[10px] text-[#64748b] uppercase tracking-wide">
            {analytics.trends.growthRate > 0 ? '+' : ''}{analytics.trends.growthRate.toFixed(1)}% / 30d
          </div>
        </div>
      </div>

      {/* Daily Stars Chart */}
      <div className="bg-[#0d1424]/80 border border-[#1e3a5f] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-white">Daily Stars (Last {timeRange} days)</h4>
          <div className="flex items-center gap-2 text-[10px] text-[#64748b]">
            <Calendar size={12} />
            <span>Peak: {analytics.trends.peakDay.stars} on {analytics.trends.peakDay.date}</span>
          </div>
        </div>
        
        {/* Bar chart */}
        <div className="h-32 flex items-end gap-px">
          {chartData.map((day, i) => {
            const height = (day.daily / maxDailyStars) * 100;
            const isToday = i === chartData.length - 1;
            const isPeak = day.date === analytics.trends.peakDay.date;
            
            return (
              <div
                key={day.date}
                className="flex-1 group relative"
                title={`${day.date}: ${day.daily} stars`}
              >
                <div
                  className={`w-full rounded-t transition-all duration-200 ${
                    isPeak 
                      ? 'bg-[#fbbf24]' 
                      : isToday 
                      ? 'bg-[#00d4ff]' 
                      : 'bg-[#3b82f6] hover:bg-[#60a5fa]'
                  }`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="bg-[#0a0f1a] border border-[#1e3a5f] rounded px-2 py-1 text-[10px] whitespace-nowrap">
                    <div className="text-white font-medium">{day.daily} ⭐</div>
                    <div className="text-[#64748b]">{day.date}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* X-axis labels */}
        <div className="flex justify-between mt-2 text-[9px] text-[#475569]">
          <span>{chartData[0]?.date}</span>
          <span>{chartData[Math.floor(chartData.length / 2)]?.date}</span>
          <span>{chartData[chartData.length - 1]?.date}</span>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
          <div className="text-[#64748b] text-[10px] uppercase mb-1">Repo Age</div>
          <div className="text-white font-medium">
            {analytics.ageInDays.toLocaleString()} days
          </div>
          <div className="text-[10px] text-[#475569]">
            Since {analytics.createdAt}
          </div>
        </div>
        
        <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
          <div className="text-[#64748b] text-[10px] uppercase mb-1">Lifetime Avg</div>
          <div className="text-white font-medium">
            {analytics.avgStarsPerDay.toFixed(2)} stars/day
          </div>
          <div className="text-[10px] text-[#475569]">
            All-time average
          </div>
        </div>
        
        <div className="bg-[#1e3a5f]/20 rounded-lg p-3">
          <div className="text-[#64748b] text-[10px] uppercase mb-1">30-Day Avg</div>
          <div className="text-white font-medium">
            {analytics.trends.avg30d} stars/day
          </div>
          <div className="text-[10px] text-[#475569]">
            Recent momentum
          </div>
        </div>
      </div>
    </div>
  );
};

export default StarAnalytics;

