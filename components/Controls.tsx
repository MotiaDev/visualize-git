import React, { useState } from 'react';
import { Search, Loader2, Key, ChevronDown } from 'lucide-react';

interface ControlsProps {
  isLoading: boolean;
  onVisualize: (owner: string, repo: string, token: string) => void;
}

const Controls: React.FC<ControlsProps> = ({ isLoading, onVisualize }) => {
  const [inputValue, setInputValue] = useState('motiadev/motia');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parts = inputValue.split('/');
    if (parts.length === 2) {
      onVisualize(parts[0], parts[1], token);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="owner/repository"
            className="w-full px-3 py-2 bg-[#0d1424] border border-[#1e3a5f] rounded text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#00d4ff] transition-colors font-mono"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !inputValue.includes('/')}
          className="px-4 py-2 bg-[#00d4ff] hover:bg-[#00b8e0] text-[#050810] font-medium text-sm rounded transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          <span>Explore</span>
        </button>
      </div>

      <button 
        type="button" 
        onClick={() => setShowToken(!showToken)}
        className="flex items-center gap-1 text-[10px] text-[#475569] hover:text-[#64748b] transition-colors"
      >
        <Key size={10} />
        <span>Token</span>
        <ChevronDown size={10} className={`transition-transform ${showToken ? 'rotate-180' : ''}`} />
      </button>

      {showToken && (
        <div className="space-y-1">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="w-full px-3 py-1.5 bg-[#0d1424] border border-[#1e3a5f] rounded text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#00d4ff] transition-colors font-mono"
          />
          <p className="text-[9px] text-[#475569]">
            Increases rate limit · <a 
              href="https://github.com/settings/tokens/new?scopes=public_repo&description=GitGalaxy" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#00d4ff] hover:underline"
            >Get token →</a>
          </p>
        </div>
      )}
    </form>
  );
};

export default Controls;
