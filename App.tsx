import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { RepoData, RepoInfo, RepoNode } from './types';
import { fetchRepoDetails, fetchRepoTree, watchRepo, subscribeToRepoUpdates, RepoUpdate, fetchCommits, CommitData } from './services/githubService';
import Visualizer from './components/Visualizer';
import Controls from './components/Controls';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import StarAnimation from './components/StarAnimation';
import StarHistoryPage from './components/StarHistoryPage';
import { GitCommit, RefreshCw, Radio, Menu, X, Github } from 'lucide-react';

// Lazy load Analytics to avoid import errors in development
const Analytics = lazy(() => 
  import('@vercel/analytics/react').then(mod => ({ default: mod.Analytics })).catch(() => ({ default: () => null }))
);

const STORAGE_KEY = 'git_history_repo';
const TOKEN_KEY = 'git_history_token';

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
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const hasAutoLoaded = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // Auto-load last viewed repo on mount
  useEffect(() => {
    if (hasAutoLoaded.current) return;
    hasAutoLoaded.current = true;
    
    const savedRepo = localStorage.getItem(STORAGE_KEY);
    const savedToken = localStorage.getItem(TOKEN_KEY) || '';
    
    if (savedRepo && savedRepo.includes('/')) {
      const [owner, repo] = savedRepo.split('/');
      if (owner && repo) {
        handleVisualize(owner, repo, savedToken);
      }
    }
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
    setCommits([]); // Clear commits for timeline

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
      let errorMessage = err.message || "An unexpected error occurred.";
      
      // Check for rate limit error
      if (errorMessage.includes("rate limit") || errorMessage.includes("403")) {
        errorMessage = "GitHub API rate limit exceeded. Please add a GitHub Token in the controls above to continue.";
      }
      
      setError(errorMessage);
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

  const handleLoadCommits = useCallback(async () => {
    if (!repoInfo || isLoadingCommits) return;
    
    setIsLoadingCommits(true);
    try {
      const [owner, repo] = repoInfo.fullName.split('/');
      const result = await fetchCommits(owner, repo, currentToken);
      setCommits(result.commits);
    } catch (err) {
      console.error('Failed to load commits:', err);
    } finally {
      setIsLoadingCommits(false);
    }
  }, [repoInfo, currentToken, isLoadingCommits]);

  return (
    <div className="flex h-screen w-full bg-[#050810] text-[#e2e8f0] overflow-hidden font-mono">
      
      {/* Vercel Web Analytics */}
      {import.meta.env.PROD && (
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      )}
      
      {/* Star Animation Overlay */}
      <StarAnimation starCount={repoInfo?.stars || 0} isActive={showStarAnimation} />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col relative">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-20 p-3 sm:p-4">
          <div className="max-w-lg mx-auto pr-10 sm:pr-0">
            {/* Logo + GitHub Link */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#00d4ff]">
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="0.5" opacity="0.3"/>
              </svg>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                git<span className="text-[#00d4ff]">-history</span>
              </h1>
              {isWatching && (
                <span className="flex items-center gap-1 text-[10px] text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full border border-[#22c55e]/20">
                  <Radio size={8} className="animate-pulse" />
                  live
                </span>
              )}
              <a
                href="https://github.com/MotiaDev/visualize-git"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-[#94a3b8] hover:text-white bg-[#1e3a5f]/50 hover:bg-[#1e3a5f] border border-[#1e3a5f] rounded-full transition-colors ml-1"
                title="View source on GitHub - Open Source!"
              >
                <Github size={12} />
                <span className="hidden sm:inline">Open Source</span>
              </a>
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

        {/* Visualization - add bottom padding on mobile for nav bar */}
        <div className="flex-1 w-full h-full pb-16 sm:pb-0">
           {data.nodes.length > 0 ? (
               <Visualizer 
                 data={data} 
                 onNodeSelect={setSelectedNode} 
              highlightedNodes={highlightedNodes}
              focusNode={focusNode}
              commits={commits}
              isLoadingCommits={isLoadingCommits}
              onLoadCommits={handleLoadCommits}
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
          <div className="absolute bottom-4 left-4 z-20 w-64 sm:w-72 hidden sm:block">
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

      {/* Sidebar - Desktop */}
      {(repoInfo || loading) && (
        <div className="z-30 h-full hidden sm:block">
          <Sidebar 
            repoInfo={repoInfo} 
            selectedNode={selectedNode} 
            onOpenStarHistory={() => setShowStarHistoryPage(true)}
            token={currentToken}
          />
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      {repoInfo && !showStarHistoryPage && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d1424]/95 backdrop-blur border-t border-[#1e3a5f] p-2 flex items-center justify-around sm:hidden safe-area-pb">
          <button 
            onClick={() => setShowMobileSidebar(true)}
            className="flex flex-col items-center gap-0.5 text-[#64748b] hover:text-white px-4 py-1"
          >
            <Menu size={18} />
            <span className="text-[9px]">Details</span>
          </button>
          
          <button 
            onClick={() => setShowStarHistoryPage(true)}
            className="flex flex-col items-center gap-0.5 text-[#fbbf24] hover:text-[#fbbf24]/80 px-4 py-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[9px]">Stars</span>
          </button>
        </div>
      )}

      {/* Sidebar - Mobile Overlay */}
      {showMobileSidebar && (repoInfo || loading) && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div 
            className="absolute inset-0 bg-black/60" 
            onClick={() => setShowMobileSidebar(false)}
          />
          <div className="absolute right-0 top-0 h-full w-72 max-w-[80vw] shadow-2xl">
            <button 
              onClick={() => setShowMobileSidebar(false)}
              className="absolute top-3 right-3 z-10 p-1.5 bg-[#1e3a5f] rounded-full text-[#64748b] hover:text-white"
            >
              <X size={16} />
            </button>
            <Sidebar 
              repoInfo={repoInfo} 
              selectedNode={selectedNode} 
              onOpenStarHistory={() => {
                setShowStarHistoryPage(true);
                setShowMobileSidebar(false);
              }}
              token={currentToken}
            />
          </div>
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
