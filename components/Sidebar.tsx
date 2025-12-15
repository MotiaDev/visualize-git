import React from 'react';
import { RepoInfo, RepoNode } from '../types';
import { Star, GitFork, Code, Folder, File, ExternalLink } from 'lucide-react';
import StarHistory from './StarHistory';

interface SidebarProps {
  repoInfo: RepoInfo | null;
  selectedNode: RepoNode | null;
  onOpenStarHistory: () => void;
  token?: string;
}

const getGitHubUrl = (repoInfo: RepoInfo | null, node: RepoNode): string | null => {
  if (!repoInfo || node.id === 'ROOT') return null;
  const base = `https://github.com/${repoInfo.owner.login}/${repoInfo.name}`;
  return node.type === 'tree' 
    ? `${base}/tree/main/${node.path}`
    : `${base}/blob/main/${node.path}`;
};

const Sidebar: React.FC<SidebarProps> = ({ repoInfo, selectedNode, onOpenStarHistory, token }) => {
  return (
    <div className="w-72 h-full bg-[#0d1424] border-l border-[#1e3a5f] flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* Repo Info */}
      {repoInfo && (
        <div className="p-4 border-b border-[#1e3a5f]">
          <div className="flex items-center gap-3 mb-3">
            <img 
              src={repoInfo.owner.avatar} 
              alt={repoInfo.owner.login}
              className="w-12 h-12 rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-white truncate">{repoInfo.name}</h2>
              <p className="text-[10px] text-[#64748b]">{repoInfo.owner.login}</p>
            </div>
          </div>
          
          {repoInfo.description && (
            <p className="text-[11px] text-[#94a3b8] mb-3 line-clamp-3">
              {repoInfo.description}
            </p>
          )}

          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1 text-[#fbbf24]">
              <Star size={12} className="fill-current" />
              {repoInfo.stars?.toLocaleString() || '0'}
            </span>
            <span className="flex items-center gap-1 text-[#64748b]">
              <GitFork size={12} />
              {repoInfo.forks?.toLocaleString() || '0'}
            </span>
            {repoInfo.language && (
              <span className="flex items-center gap-1 text-[#00d4ff]">
                <Code size={12} />
                {repoInfo.language}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Star History Chart */}
      {repoInfo && (
        <StarHistory repoInfo={repoInfo} onOpenFullPage={onOpenStarHistory} token={token} />
      )}

      {/* Selected Node */}
      {selectedNode && (
        <div className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-[#475569] mb-2">Selected</h3>
          <div className="bg-[#0a0f1a] border border-[#1e3a5f] rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              {selectedNode.type === 'tree' ? (
                <Folder size={14} className="text-[#3b82f6]" />
              ) : (
                <File size={14} className="text-[#64748b]" />
              )}
              <span className="text-sm text-white font-mono truncate flex-1">{selectedNode.name}</span>
            </div>
            
            <div className="space-y-1.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-[#475569]">Path</span>
                <span className="text-[#94a3b8] font-mono truncate max-w-[160px]" title={selectedNode.path}>
                  {selectedNode.path || '/'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">Type</span>
                <span className="text-[#94a3b8]">{selectedNode.type === 'tree' ? 'Directory' : 'File'}</span>
              </div>
              {selectedNode.extension && (
                <div className="flex justify-between">
                  <span className="text-[#475569]">Extension</span>
                  <span className="text-[#00d4ff] font-mono">.{selectedNode.extension}</span>
                </div>
              )}
              {selectedNode.size && (
                <div className="flex justify-between">
                  <span className="text-[#475569]">Size</span>
                  <span className="text-[#94a3b8]">
                    {selectedNode.size > 1024 
                      ? `${(selectedNode.size / 1024).toFixed(1)} KB`
                      : `${selectedNode.size} B`
                    }
                  </span>
                </div>
              )}
            </div>

            {/* Open on GitHub button */}
            {getGitHubUrl(repoInfo, selectedNode) && (
              <a
                href={getGitHubUrl(repoInfo, selectedNode)!}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 w-full py-2 bg-[#1e3a5f] hover:bg-[#2a4a6f] text-[#00d4ff] text-[11px] rounded transition-colors"
              >
                <ExternalLink size={12} />
                Open on GitHub
              </a>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedNode && repoInfo && (
        <div className="p-4">
          <p className="text-[10px] text-[#475569] text-center">
            Click a node to see details
          </p>
        </div>
      )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="p-4 border-t border-[#1e3a5f] mt-auto hidden sm:block">
        <h3 className="text-[10px] uppercase tracking-wider text-[#475569] mb-2">Tips</h3>
        <div className="text-[9px] text-[#475569] space-y-1">
          <p>• Scroll to zoom in/out</p>
          <p>• Drag to pan the view</p>
          <p>• Drag nodes to reposition</p>
          <p>• Hover to see path to root</p>
          <p>• Search to filter files</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
