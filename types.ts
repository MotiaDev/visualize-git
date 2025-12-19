import { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface RepoNode extends SimulationNodeDatum {
  id: string;
  name: string;
  type: 'blob' | 'tree'; // blob = file, tree = directory
  path: string;
  size?: number;
  extension?: string;
  parentId?: string | null;
  children?: RepoNode[]; // For hierarchical layouts
  // D3 Simulation properties (optional but good for TS correctness)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface RepoLink extends SimulationLinkDatum<RepoNode> {
  source: string | RepoNode;
  target: string | RepoNode;
}

export interface RepoData {
  nodes: RepoNode[];
  links: RepoLink[];
}

export interface RepoInfo {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  defaultBranch: string;
  url: string;
  owner: {
    login: string;
    avatar: string;
  };
}

export interface TreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}
}