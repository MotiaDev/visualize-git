import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RepoData, RepoInfo, RepoNode } from './types';
import { fetchRepoDetails, fetchRepoTree, watchRepo, subscribeToRepoUpdates, RepoUpdate } from './services/githubService';
import Visualizer from './components/Visualizer';
import Controls from './components/Controls';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import StarAnimation from './components/StarAnimation';
import StarHistoryPage from './components/StarHistoryPage';
import { GitCommit, RefreshCw, Radio } from 'lucide-react';

const App: React.FC = () => {
  const [data, setData] = useState<RepoData>({ nodes: [], links: [] });
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<RepoUpdate[]>([]);
  const [isWatching, setIsWatching] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [focusNode, setFocusNode] = useState<RepoNode | null>(null);
  const [showStarAnimation, setShowStarAnimation] = useState(false);
  const [showStarHistoryPage, setShowStarHistoryPage] = useState(false);
  const [currentToken, setCurrentToken] = useState<string>('');
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const handleVisualize = async (owner: string, repo: string, token: string) => {
    setLoading(true);
    setError(null);
    setData({ nodes: [], links: [] });
    setRepoInfo(null);
    setSelectedNode(null);
    setUpdates([]);
    setHighlightedNodes(new Set());
    setFocusNode(null);
    setCurrentToken(token); // Store token for star history

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    try {
      const info = await fetchRepoDetails(owner, repo, token);
      setRepoInfo(info);
      
      // Trigger star animation
      setShowStarAnimation(true);
      setTimeout(() => setShowStarAnimation(false), 5000);
      
      const treeData = await fetchRepoTree(owner, repo, 'main', token);
      setData(treeData);

      if (treeData.nodes.length === 0) {
        setError("Repository appears empty or failed to parse tree.");
        return;
      }

      // Real-time watching only works in local development
      // In production, it requires GitHub webhooks to be configured
      const isProduction = import.meta.env.PROD;
      
      if (!isProduction) {
        try {
          const watchResult = await watchRepo(owner, repo, token);
          setWatchId(watchResult.watchId);
          setIsWatching(true);

          const unsubscribe = subscribeToRepoUpdates(
            watchResult.watchId,
            (update) => {
              setUpdates(prev => [update, ...prev].slice(0, 8));
              if (update.type === 'commit') {
                fetchRepoTree(owner, repo, 'main', token)
                  .then(newData => setData(newData))
                  .catch(console.error);
              }
            },
            () => setIsWatching(false)
          );
          unsubscribeRef.current = unsubscribe;
        } catch (watchError) {
          console.warn('Could not start watching:', watchError);
        }
      }

    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!watchId) return;
    setLoading(true);
    try {
      const [owner, repo] = watchId.split('/');
      const treeData = await fetchRepoTree(owner, repo, 'main');
      setData(treeData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleHighlight = useCallback((nodeIds: Set<string>) => {
    setHighlightedNodes(nodeIds);
  }, []);

  const handleFocusNode = useCallback((node: RepoNode) => {
    setFocusNode(node);
    setSelectedNode(node);
    setHighlightedNodes(new Set([node.id]));
  }, []);

  return (
    <div className="flex h-screen w-full bg-[#050810] text-[#e2e8f0] overflow-hidden font-mono">
      
      {/* Star Animation Overlay */}
      <StarAnimation starCount={repoInfo?.stars || 0} isActive={showStarAnimation} />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col relative">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-20 p-4">
          <div className="max-w-lg mx-auto">
            {/* Logo */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#00d4ff]">
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="0.5" opacity="0.3"/>
              </svg>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                git<span className="text-[#00d4ff]">galaxy</span>
              </h1>
              {isWatching && (
                <span className="flex items-center gap-1 text-[10px] text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full border border-[#22c55e]/20">
                  <Radio size={8} className="animate-pulse" />
                  live
                </span>
              )}
            </div>
            
            {/* Controls */}
            <Controls isLoading={loading} onVisualize={handleVisualize} />
            
            {/* Search Bar - only show when we have data */}
            {data.nodes.length > 0 && (
              <div className="mt-2">
                <SearchBar 
                  nodes={data.nodes} 
                  onHighlight={handleHighlight}
                  onFocusNode={handleFocusNode}
                />
              </div>
            )}
            
            {/* Error */}
            {error && (
              <div className="mt-3 bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#fca5a5] px-3 py-2 rounded text-xs">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Visualization */}
        <div className="flex-1 w-full h-full">
          {data.nodes.length > 0 ? (
            <Visualizer 
              data={data} 
              onNodeSelect={setSelectedNode}
              highlightedNodes={highlightedNodes}
              focusNode={focusNode}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center">
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none" className="text-[#1e3a5f] opacity-30">
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
                <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="0.5"/>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="0.3"/>
                <circle cx="5" cy="8" r="1" fill="currentColor" opacity="0.5"/>
                <circle cx="19" cy="16" r="1" fill="currentColor" opacity="0.5"/>
                <circle cx="8" cy="18" r="0.5" fill="currentColor" opacity="0.3"/>
              </svg>
              <p className="mt-4 text-sm text-[#475569]">Enter a repository to visualize</p>
            </div>
          )}
        </div>

        {/* Live Updates */}
        {updates.length > 0 && (
          <div className="absolute bottom-4 left-4 z-20 w-72">
            <div className="bg-[#0d1424]/95 border border-[#1e3a5f] rounded overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3a5f]">
                <span className="text-[10px] text-[#64748b] flex items-center gap-1.5">
                  <GitCommit size={12} />
                  Activity
                </span>
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="p-1 hover:bg-[#1e3a5f] rounded transition-colors text-[#64748b] hover:text-[#00d4ff]"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto">
                {updates.map((update, i) => (
                  <div key={update.id || i} className="px-3 py-2 border-b border-[#1e3a5f]/50 last:border-0">
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1 ${
                        update.type === 'commit' ? 'bg-[#22c55e]' : 'bg-[#3b82f6]'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-[#cbd5e1] truncate">{update.message}</p>
                        <p className="text-[9px] text-[#475569]">
                          {update.author && `${update.author} · `}
                          {update.sha && <code className="text-[#64748b]">{update.sha}</code>}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      {(repoInfo || loading) && (
        <div className="z-30 h-full">
          <Sidebar 
            repoInfo={repoInfo} 
            selectedNode={selectedNode} 
            onOpenStarHistory={() => setShowStarHistoryPage(true)}
            token={currentToken}
          />
        </div>
      )}

      {/* Star History Full Page */}
      {showStarHistoryPage && repoInfo && (
        <StarHistoryPage 
          repoInfo={repoInfo} 
          onClose={() => setShowStarHistoryPage(false)}
          token={currentToken}
        />
      )}
    </div>
  );
};

export default App;
